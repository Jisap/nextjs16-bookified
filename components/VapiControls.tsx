'use client';

import { Mic, MicOff } from "lucide-react";
import useVapi from "@/hooks/useVapi";
import { IBook } from "@/types";
import Image from "next/image";
import Transcript from "@/components/Transcript";
import { toast } from "sonner";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Gestiona la interfaz de usuario para la conversación de voz, incluyendo controles de micrófono,
 * indicadores de estado y la transcripción. Utiliza el hook `useVapi` para la lógica de comunicación
 * con el servicio de IA de voz.
 */


const VapiControls = ({ book }: { book: IBook }) => {

  // Hook personalizado para gestionar el estado de Vapi.
  const {
    status,
    isActive,
    messages,
    currentMessage,
    currentUserMessage,
    duration,
    start,
    stop,
    clearError,
    limitError,
    isBillingError,
    maxDurationSeconds
  } = useVapi(book);

  const router = useRouter();

  // Efecto para manejar errores de límite de suscripción.
  useEffect(() => {
    if (limitError) {                                         // Si existe un error de límite.
      toast.error(limitError);                                // Muestra una notificación de error.
      if (isBillingError) {                                   // Si es un error relacionado con la facturación.
        router.push("/subscriptions");                        // Redirige a la página de suscripciones.
      } else {
        router.push("/");                                     // De lo contrario, redirige a la página de inicio.
      }
      clearError();                                           // Limpia el estado de error.
    }
  }, [isBillingError, limitError, router, clearError]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Función para obtener la etiqueta y el color según el estado de la llamada de Vapi.
  const getStatusDisplay = () => {
    switch (status) {
      case 'connecting': return { label: 'Conectando...', color: 'vapi-status-dot-connecting' }; // Estado mientras se conecta.
      case 'starting': return { label: 'Iniciando...', color: 'vapi-status-dot-starting' };      // Estado al iniciar la llamada.
      case 'listening': return { label: 'Escuchando', color: 'vapi-status-dot-listening' };      // Estado cuando está escuchando al usuario.
      case 'thinking': return { label: 'Pensando...', color: 'vapi-status-dot-thinking' };       // Estado cuando la IA está procesando.
      case 'speaking': return { label: 'Hablando', color: 'vapi-status-dot-speaking' };          // Estado cuando la IA está hablando.
      default: return { label: 'Listo', color: 'vapi-status-dot-ready' };                        // Estado por defecto/inactivo.
    }
  };

  const statusDisplay = getStatusDisplay(); // Obtiene el objeto de visualización del estado actual.

  return (
    <>
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        {/* Header Card */}
        <div className="vapi-header-card">
          <div className="vapi-cover-wrapper">
            <Image
              src={book.coverURL || "/images/book-placeholder.png"}                   // URL de la portada del libro, con una imagen de respaldo.
              alt={book.title}
              width={120}
              height={180}
              className="vapi-cover-image !w-[120px] !h-auto"
              priority
            />
            <div className="vapi-mic-wrapper relative">
              {isActive && (status === 'speaking' || status === 'thinking') && (      // Muestra animación de pulso cuando la IA está activa y pensando/hablando.
                <div className="absolute inset-0 rounded-full bg-white animate-ping opacity-75" />
              )}
              <button
                onClick={isActive ? stop : start}                                     // Alterna entre iniciar y detener la conversación.
                disabled={status === 'connecting'}                                    // Deshabilita el botón mientras se conecta.
                className={`                                                            
                  vapi-mic-btn shadow-md !w-[60px] !h-[60px] z-10 
                  ${isActive
                    ? 'vapi-mic-btn-active'
                    : 'vapi-mic-btn-inactive'
                  }`                                                                  // Clases dinámicas para el estado activo/inactivo.
                }
              >
                {isActive ? (                                                         // Si la conversación está activa.
                  <Mic className="size-7 text-white" />                             // Muestra el ícono de micrófono activo.
                ) : (
                  <MicOff className="size-7 text-[#212a3b]" />                      // Muestra el ícono de micrófono inactivo.
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 flex-1">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#212a3b] mb-1">
                {book.title}
              </h1>

              <p className="text-[#3d485e] font-medium">by {book.author}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="vapi-status-indicator">
                <span className={`vapi-status-dot ${statusDisplay.color}`} /> {/* Punto de color dinámico para el estado. */}

                <span className="vapi-status-text">{statusDisplay.label}</span> {/* Etiqueta de texto dinámica para el estado. */}
              </div>

              <div className="vapi-status-indicator">
                <span className="vapi-status-text">Voz: {book.persona || "Daniel"}</span> {/* Muestra la persona de voz seleccionada. */}
              </div>

              <div className="vapi-status-indicator">
                <span className="vapi-status-text">
                  {formatDuration(duration)}/{formatDuration(maxDurationSeconds)} {/* Muestra la duración actual y la duración máxima. */}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="vapi-transcript-wrapper">
          <div className="transcript-container min-h-[400px]">
            <Transcript
              messages={messages}                               // Pasa todos los mensajes completados.
              currentMessage={currentMessage}                   // Pasa el mensaje actual que se está recibiendo del asistente.
              currentUserMessage={currentUserMessage}           // Pasa el mensaje actual que se está recibiendo del usuario.
            />
          </div>
        </div>
      </div>
    </>
  )
}
export default VapiControls