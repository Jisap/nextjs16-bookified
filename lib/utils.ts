import { TextSegment } from '@/types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DEFAULT_VOICE, voiceOptions } from './constants';


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Serialize Mongoose documents to plain JSON objects (strips ObjectId, Date, etc.)
export const serializeData = <T>(data: T): T => JSON.parse(JSON.stringify(data));

// Auto generate slug
export function generateSlug(text: string): string {
  return text
    .replace(/\.[^/.]+$/, '') // Remove file extension (.pdf, .txt, etc.)
    .toLowerCase() // Convert to lowercase
    .trim() // Remove whitespace from both ends
    .replace(/[^\w\s-]/g, '') // Remove special characters (keep letters, numbers, spaces, hyphens)
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Escape regex special characters to prevent ReDoS attacks
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Splits text content into segments for MongoDB storage and search
export const splitIntoSegments = (
  text: string,
  segmentSize: number = 500, // Maximum words per segment
  overlapSize: number = 50,  // Words to overlap between segments for context
): TextSegment[] => {

  if (segmentSize <= 0) {                                                                 // Validate parameters to prevent infinite loops
    throw new Error('segmentSize must be greater than 0');
  }
  if (overlapSize < 0 || overlapSize >= segmentSize) {
    throw new Error('overlapSize must be >= 0 and < segmentSize');
  }

  const words = text.split(/\s+/).filter((word) => word.length > 0);                      // Split text into words
  const segments: TextSegment[] = [];                                                     // Inicializa el array de segmentos

  let segmentIndex = 0;                                                                   // Inicializa el índice del segmento
  let startIndex = 0;                                                                     // Inicializa el índice de inicio

  while (startIndex < words.length) {                                                     // Mientras el índice < que el total de palabras
    const endIndex = Math.min(startIndex + segmentSize, words.length);                    // Obtiene el índice final
    const segmentWords = words.slice(startIndex, endIndex);                               // Obtiene el segmento de texto
    const segmentText = segmentWords.join(' ');                                           // Une las palabras con espacios

    segments.push({                                                                       // Agrega el segmento al array
      text: segmentText,
      segmentIndex,
      wordCount: segmentWords.length,
    });

    segmentIndex++;

    if (endIndex >= words.length) break;
    startIndex = endIndex - overlapSize;
  }

  return segments;
};

// Get voice data by persona key or voice ID
export const getVoice = (persona?: string) => {
  if (!persona) return voiceOptions[DEFAULT_VOICE];

  // Find by voice ID
  const voiceEntry = Object.values(voiceOptions).find((v) => v.id === persona);
  if (voiceEntry) return voiceEntry;

  // Find by key
  const voiceByKey = voiceOptions[persona as keyof typeof voiceOptions];
  if (voiceByKey) return voiceByKey;

  // Default fallback
  return voiceOptions[DEFAULT_VOICE];
};

// Format duration in seconds to MM:SS format
export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export async function parsePDFFile(file: File) {
  try {
    // pdfjs-dist es la librería que permite leer PDFs
    const pdfjsLib = await import('pdfjs-dist');                           // Importación dinámica para no cargar la librería hasta que sea necesaria (ahorra peso inicial)

    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
    }

    // 1. Lee el archivo binario
    const arrayBuffer = await file.arrayBuffer();                          // Convierte el File object a un buffer que PDF.js pueda leer

    // 2. Carga el documento PDF
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });       // Inicia la tarea de carga
    const pdfDocument = await loadingTask.promise;                         // Espera a que el PDF esté listo en memoria

    // 3. Genera la Portada (Renderiza la página 1)
    const firstPage = await pdfDocument.getPage(1);                        // Obtiene la primera página
    const viewport = firstPage.getViewport({ scale: 2 });                  // Escala 2x para que la portada se vea nítida en pantallas retina

    const canvas = document.createElement('canvas');                       // Crea un canvas en memoria (no visible)
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not get canvas context');
    }

    // Dibuja la página en el canvas
    await firstPage.render({
      canvasContext: context,
      viewport: viewport,
    } as any).promise;

    // Convierte el canvas a una imagen PNG (Data URL base64)
    const coverDataURL = canvas.toDataURL('image/png');

    // 4. Extracción de Texto (Loop por todas las páginas)
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent(); // Obtiene los elementos de texto de la página
      const pageText = textContent.items
        .filter((item) => 'str' in item)               // Filtra elementos vacíos o de formato
        .map((item) => (item as { str: string }).str)  // Extrae solo el string de texto
        .join(' ');                                    // Une las palabras con espacios
      fullText += pageText + '\n';                     // Añade el texto de la página al total
    }

    // 5. Segmentación (Divide el texto gigante en trozos manejables para la IA)
    const segments = splitIntoSegments(fullText);       // Usa la función de ventana deslizante definida arriba

    // Limpieza de memoria
    await pdfDocument.destroy();

    return {
      content: segments,
      cover: coverDataURL,
    };
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw new Error(`Failed to parse PDF file: ${error instanceof Error ? error.message : String(error)}`);
  }
}