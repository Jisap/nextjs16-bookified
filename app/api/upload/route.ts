import { NextResponse } from "next/server";
import { handleUpload, HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@clerk/nextjs/server";
import { MAX_FILE_SIZE } from "@/lib/constants";

/**
 * Maneja la solicitud POST para autorizar y configurar una subida de archivos a Vercel Blob.
 *
 * Este endpoint realiza las siguientes acciones:
 * 1. Autentica al usuario actual utilizando Clerk.
 * 2. Valida la solicitud de subida.
 * 3. Genera un token de cliente con restricciones de seguridad (tipos de archivo, tamaño máximo).
 * 4. Define el hook `onUploadCompleted` para acciones posteriores a la subida.
 *
 * @param request - La solicitud HTTP entrante con los detalles de la subida.
 * @returns Una promesa que resuelve a una respuesta JSON con el token de autorización o un mensaje de error.
 */


export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;       // Obtiene el cuerpo de la solicitud

    const jsonResponse = await handleUpload({                      // Maneja la subida de archivos
      token: process.env.bookified_READ_WRITE_TOKEN,                  // Token de Vercel Blob para autorizar la subida
      body,                                                           // Cuerpo de la solicitud
      request,                                                        // Solicitud HTTP entrante
      onBeforeGenerateToken: async () => {                         // Hook que se ejecuta antes de autorizar la subida
        const { userId } = await auth();                              // Verifica la sesión del usuario con clerk

        if (!userId) {                                             // Si no hay usuario autenticado 
          throw new Error('Unauthorized: User not authenticated'); // bloquea usuarios no logueados
        }

        return {
          allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_FILE_SIZE,
          tokenPayload: JSON.stringify({ userId })                // Guarda metadatos en el token para usarlos al completar
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {      // Hook que se ejecuta cuando la subida finaliza exitosamente
        console.log('File uploaded to blob: ', blob.url)

        const payload = tokenPayload ? JSON.parse(tokenPayload) : null
        const userId = payload?.userId;

        // TODO: PostHog
      }
    });

    return NextResponse.json(jsonResponse)
  } catch (e) {
    const message = e instanceof Error ? e.message : "An unknown error occurred";
    const status = message.includes('Unauthorized') ? 401 : 500;
    console.error('Upload error', e);
    const clientMessage = status === 401 ? 'Unauthorized' : 'Upload failed';
    return NextResponse.json({ error: clientMessage }, { status });
  }
}