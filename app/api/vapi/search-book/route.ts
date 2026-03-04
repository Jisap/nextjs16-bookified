import { NextResponse } from 'next/server';

import { searchBookSegments } from '@/lib/actions/book.actions';

// Helper function to process book search logic
async function processBookSearch(bookId: unknown, query: unknown) {
  // Validate inputs before conversion to prevent null/undefined becoming "null"/"undefined" strings
  if (bookId == null || query == null || query === '') {
    return { result: 'Missing bookId or query' };
  }

  // Convert bookId to string
  const bookIdStr = String(bookId);
  const queryStr = String(query).trim();

  // Additional validation after conversion
  if (!bookIdStr || bookIdStr === 'null' || bookIdStr === 'undefined' || !queryStr) {
    return { result: 'Missing bookId or query' };
  }

  // Execute search
  const searchResult = await searchBookSegments(bookIdStr, queryStr, 3);

  // Return results
  if (!searchResult.success || !searchResult.data?.length) {
    return { result: 'No information found about this topic in the book.' };
  }

  const combinedText = searchResult.data
    .map((segment) => (segment as { content: string }).content)
    .join('\n\n');

  return { result: combinedText };
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}

// Parse tool arguments that may arrive as a JSON string or an object
function parseArgs(args: unknown): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return args as Record<string, unknown>;
}

/**
 * Maneja las solicitudes POST desde Vapi (Server URL).
 * Actúa como una "Tool" para la IA, permitiéndole buscar contenido dentro de un libro específico.
 * Soporta tanto el formato antiguo de `functionCall` como el nuevo estándar de `toolCallList` (OpenAI).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();                                            // Parsea el cuerpo de la solicitud entrante (payload de Vapi).

    console.log('Vapi search-book request:', JSON.stringify(body, null, 2));

    // Support multiple Vapi formats
    const functionCall = body?.message?.functionCall;                             // Intenta obtener formato antiguo/simple de llamada a función.
    const toolCallList = body?.message?.toolCallList || body?.message?.toolCalls; // Intenta obtener formato nuevo (lista de herramientas).

    // Handle single functionCall format
    if (functionCall) {                                                           // Si la solicitud usa el formato de función única.
      const { name, parameters } = functionCall;
      const parsed = parseArgs(parameters);                                       // Parsea los argumentos (bookId, query).

      if (name === 'searchBook') {                                                // Verifica si la función solicitada es la correcta.
        const result = await processBookSearch(parsed.bookId, parsed.query);      // Ejecuta la lógica de búsqueda.
        return NextResponse.json(result);                                         // Devuelve el resultado directamente.
      }

      return NextResponse.json({ result: `Unknown function: ${name}` });          // Retorna error si la función no existe.
    }

    // Handle toolCallList format (array of calls)
    if (!toolCallList || toolCallList.length === 0) {                             // Si no se detecta ningún formato válido de llamada.
      return NextResponse.json({
        results: [{ result: 'No tool calls found' }],                             // Devuelve un error indicando ausencia de llamadas.
      });
    }

    const results = [];                                                           // Array para acumular resultados (Vapi puede enviar múltiples llamadas a la vez).

    for (const toolCall of toolCallList) {                                        // Itera sobre cada llamada a herramienta solicitada.
      const { id, function: func } = toolCall;
      const name = func?.name;
      const args = parseArgs(func?.arguments);                                    // Parsea los argumentos de esta llamada específica.

      if (name === 'searchBook') {                                                // Si la herramienta es 'searchBook'.
        const searchResult = await processBookSearch(args.bookId, args.query);    // Realiza la búsqueda.
        results.push({ toolCallId: id, ...searchResult });                        // Agrega el resultado vinculándolo al ID de la llamada (requerido).
      } else {
        results.push({ toolCallId: id, result: `Unknown function: ${name}` });    // Maneja herramientas desconocidas.
      }
    }

    return NextResponse.json({ results });                                        // Devuelve la lista completa de resultados a Vapi.
  } catch (error) {
    console.error('Vapi search-book error:', error);
    return NextResponse.json({
      results: [{ result: 'Error processing request' }],                           // Manejo de errores generales del servidor.
    });
  }
}