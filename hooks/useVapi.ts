'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Vapi from '@vapi-ai/web';
import { useAuth } from '@clerk/nextjs';

import { useSubscription } from '@/hooks/useSubscription';
import { ASSISTANT_ID, DEFAULT_VOICE, VOICE_SETTINGS } from '@/lib/constants';
import { getVoice } from '@/lib/utils';
import { IBook, Messages } from '@/types';
import { startVoiceSession, endVoiceSession } from '@/lib/actions/session.actions';


export function useLatestRef<T>(value: T) {                               // Hook personalizado para mantener la referencia más reciente de un valor.
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

const VAPI_API_KEY = process.env.NEXT_PUBLIC_VAPI_API_KEY;
const TIMER_INTERVAL_MS = 1000;
const SECONDS_PER_MINUTE = 60;
const TIME_WARNING_THRESHOLD = 60; // Show warning when this many seconds remain

let vapi: InstanceType<typeof Vapi>;

function getVapi() {                                                   // Función para obtener la instancia de Vapi.
  if (!vapi) {                                                         // Si no existe la instancia.
    if (!VAPI_API_KEY) {                                               // Si no existe la clave de API.
      throw new Error('NEXT_PUBLIC_VAPI_API_KEY environment variable is not set');
    }
    vapi = new Vapi(VAPI_API_KEY);                                     // Crea la instancia de Vapi.
  }
  return vapi;
}

export type CallStatus = 'idle' | 'connecting' | 'starting' | 'listening' | 'thinking' | 'speaking';



/**
 * Hook personalizado para gestionar la integración con Vapi (IA de voz).
 * 
 * Funcionalidades principales:
 * - Inicializa y mantiene la instancia de Vapi.
 * - Gestiona el estado de la llamada (conectando, escuchando, hablando, pensando).
 * - Maneja la transcripción en tiempo real (mensajes parciales y finales).
 * - Controla la duración de la sesión y hace cumplir los límites del plan de suscripción.
 * - Sincroniza el inicio y fin de sesión con la base de datos.
 */

export function useVapi(book: IBook) {
  const { userId } = useAuth();                                        // Obtiene el ID del usuario actual (Clerk).
  const { limits } = useSubscription();                                // Obtiene los límites del plan de suscripción.

  const [status, setStatus] = useState<CallStatus>('idle');            // Estado actual de la interacción de voz.
  const [messages, setMessages] = useState<Messages[]>([]);            // Historial de mensajes completados.
  const [currentMessage, setCurrentMessage] = useState('');            // Mensaje parcial que la IA está generando.
  const [currentUserMessage, setCurrentUserMessage] = useState('');    // Mensaje parcial que el usuario está hablando.
  const [duration, setDuration] = useState(0);                         // Duración de la llamada en segundos.
  const [limitError, setLimitError] = useState<string | null>(null);   // Almacena errores de límites de uso.
  const [isBillingError, setIsBillingError] = useState(false);         // Indica si el error requiere actualización de plan.

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);                    // Referencia al ID de la sesión en base de datos.
  const isStoppingRef = useRef(false);

  // Keep refs in sync with latest values for use in callbacks
  const maxDurationSeconds = limits?.maxDurationPerSession
    ? limits.maxDurationPerSession * 60
    : (15 * 60);                                                       // Calcula duración máxima en segundos.
  const maxDurationRef = useLatestRef(maxDurationSeconds);
  const durationRef = useLatestRef(duration);
  const voice = book.persona || DEFAULT_VOICE;                         // Determina la voz a usar (personalizada o por defecto).

  // Set up Vapi event listeners
  useEffect(() => {
    const handlers = {
      'call-start': () => {
        isStoppingRef.current = false;
        setStatus('starting');                                         // La llamada ha conectado, iniciando.
        setCurrentMessage('');
        setCurrentUserMessage('');

        // Start duration timer
        startTimeRef.current = Date.now();
        setDuration(0);
        timerRef.current = setInterval(() => {
          if (startTimeRef.current) {
            const newDuration = Math.floor((Date.now() - startTimeRef.current) / TIMER_INTERVAL_MS); // Actualiza contador de segundos.
            setDuration(newDuration);

            // Check duration limit
            if (newDuration >= maxDurationRef.current) {                // Verifica si se excedió el tiempo máximo.
              getVapi().stop();                                         // Corta la llamada si se excede el límite.
              setLimitError(
                `Session time limit (${Math.floor(
                  maxDurationRef.current / SECONDS_PER_MINUTE,
                )} minutes) reached. Upgrade your plan for longer sessions.`,
              );
            }
          }
        }, TIMER_INTERVAL_MS);
      },

      'call-end': () => {
        // Don't reset isStoppingRef here - delayed events may still fire
        setStatus('idle');                                             // Restablece estado a inactivo.
        setCurrentMessage('');
        setCurrentUserMessage('');

        // Stop timer
        if (timerRef.current) {
          clearInterval(timerRef.current);                             // Limpia el intervalo del temporizador.
          timerRef.current = null;
        }

        // End session tracking
        if (sessionIdRef.current) {
          endVoiceSession(sessionIdRef.current, durationRef.current).catch((err) => // Actualiza la DB con la duración final.
            console.error('Failed to end voice session:', err),
          );
          sessionIdRef.current = null;
        }

        startTimeRef.current = null;
      },

      'speech-start': () => {
        if (!isStoppingRef.current) {
          setStatus('speaking');                                         // Indica que se detectó voz (generalmente del asistente).
        }
      },
      'speech-end': () => {
        if (!isStoppingRef.current) {
          // After AI finishes speaking, user can talk
          setStatus('listening');                                        // El asistente terminó, pasa a escuchar al usuario.
        }
      },

      message: (message: {
        type: string;
        role: string;
        transcriptType: string;
        transcript: string;
      }) => {
        if (message.type !== 'transcript') return;                       // Ignora mensajes que no sean transcripciones.

        // User finished speaking → AI is thinking
        if (message.role === 'user' && message.transcriptType === 'final') {
          if (!isStoppingRef.current) {
            setStatus('thinking');                                       // Usuario terminó frase, IA procesando respuesta.
          }
          setCurrentUserMessage('');
        }

        // Partial user transcript → show real-time typing
        if (message.role === 'user' && message.transcriptType === 'partial') {
          setCurrentUserMessage(message.transcript);                     // Muestra lo que el usuario dice en tiempo real.
          return;
        }

        // Partial AI transcript → show word-by-word
        if (message.role === 'assistant' && message.transcriptType === 'partial') {
          setCurrentMessage(message.transcript);                         // Muestra lo que la IA dice en tiempo real.
          return;
        }

        // Final transcript → add to messages
        if (message.transcriptType === 'final') {
          if (message.role === 'assistant') setCurrentMessage('');
          if (message.role === 'user') setCurrentUserMessage('');

          setMessages((prev) => {
            const isDupe = prev.some(
              (m) => m.role === message.role && m.content === message.transcript,
            );
            return isDupe ? prev : [...prev, { role: message.role, content: message.transcript }]; // Agrega mensaje confirmado al historial.
          });
        }
      },

      error: (error: Error) => {
        console.error('Vapi error:', error);
        // Don't reset isStoppingRef here - delayed events may still fire
        setStatus('idle');                                                 // En caso de error, vuelve a estado inactivo.
        setCurrentMessage('');
        setCurrentUserMessage('');

        // Stop timer on error
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        // End session tracking on error
        if (sessionIdRef.current) {
          endVoiceSession(sessionIdRef.current, durationRef.current).catch((err) =>
            console.error('Failed to end voice session on error:', err),
          );
          sessionIdRef.current = null;
        }

        // Show user-friendly error message
        const errorMessage = error.message?.toLowerCase() || '';
        if (errorMessage.includes('timeout') || errorMessage.includes('silence')) {
          setLimitError('Session ended due to inactivity. Click the mic to start again.');
        } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
          setLimitError('Connection lost. Please check your internet and try again.');
        } else {
          setLimitError('Session ended unexpectedly. Click the mic to start again.');
        }

        startTimeRef.current = null;
      },
    };

    // Register all handlers
    Object.entries(handlers).forEach(([event, handler]) => {
      getVapi().on(event as keyof typeof handlers, handler as () => void);
    });

    return () => {
      // End active session on unmount
      if (sessionIdRef.current) {
        getVapi().stop();
        endVoiceSession(sessionIdRef.current, durationRef.current).catch((err) =>
          console.error('Failed to end voice session on unmount:', err),
        );
        sessionIdRef.current = null;
      }
      // Cleanup handlers
      Object.entries(handlers).forEach(([event, handler]) => {
        getVapi().off(event as keyof typeof handlers, handler as () => void);
      });
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const start = useCallback(async () => {
    if (!userId) {
      setLimitError('Please sign in to start a voice session.');            // Requiere autenticación.
      return;
    }

    setLimitError(null);
    setIsBillingError(false);
    setStatus('connecting'); // Indica al UI que está conectando.

    try {
      // Check session limits and create session record
      const result = await startVoiceSession(userId, book._id);             // Verifica límites en servidor y crea sesión.

      if (!result.success) {
        setLimitError(result.error || 'Session limit reached. Please upgrade your plan.');
        setIsBillingError(!!result.isBillingError);
        setStatus('idle');
        return;
      }

      sessionIdRef.current = result.sessionId || null;                      // Guarda ID de sesión para cerrarla luego.
      // Note: Server-returned maxDurationMinutes is informational only
      // The actual limit is enforced by useLatestRef(limits.maxSessionMinutes * 60)

      const firstMessage = `Hey, good to meet you. Quick question before we dive in - have you actually read ${book.title} yet, or are we starting fresh?`;

      await getVapi().start(ASSISTANT_ID, {                                 // Inicia la conexión con Vapi.
        firstMessage,
        variableValues: {                                                   // Inyecta datos del libro para que la IA los use.
          title: book.title,
          author: book.author,
          bookId: book._id,
        },
        voice: {                                                            // Configura el proveedor de voz (ElevenLabs).
          provider: '11labs' as const,
          voiceId: getVoice(voice).id,
          model: 'eleven_turbo_v2_5' as const,
          stability: VOICE_SETTINGS.stability,
          similarityBoost: VOICE_SETTINGS.similarityBoost,
          style: VOICE_SETTINGS.style,
          useSpeakerBoost: VOICE_SETTINGS.useSpeakerBoost,
        },
      });
    } catch (err) {
      console.error('Failed to start call:', err);
      setStatus('idle');
      setLimitError('Failed to start voice session. Please try again.');
    }
  }, [book._id, book.title, book.author, voice, userId]);

  const stop = useCallback(() => {
    isStoppingRef.current = true;
    getVapi().stop(); // Finaliza la llamada.
  }, []);

  const clearError = useCallback(() => {
    setLimitError(null);
    setIsBillingError(false);
  }, []);

  const isActive =
    status === 'starting' ||
    status === 'listening' ||
    status === 'thinking' ||
    status === 'speaking';

  // Calculate remaining time
  // const maxDurationSeconds = limits.maxSessionMinutes * SECONDS_PER_MINUTE;
  // const remainingSeconds = Math.max(0, maxDurationSeconds - duration);
  // const showTimeWarning =
  //     isActive && remainingSeconds <= TIME_WARNING_THRESHOLD && remainingSeconds > 0;

  return {
    status,
    isActive,
    messages,
    currentMessage,
    currentUserMessage,
    duration,
    start,
    stop,
    limitError,
    isBillingError,
    maxDurationSeconds,
    clearError,
    // maxDurationSeconds,
    // remainingSeconds,
    // showTimeWarning,
  };
}

export default useVapi;