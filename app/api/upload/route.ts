import { NextResponse } from "next/server";
import { handleUpload, HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@clerk/nextjs/server";
import { MAX_FILE_SIZE } from "@/lib/constants";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      token: process.env.bookified_READ_WRITE_TOKEN,
      body,
      request,
      onBeforeGenerateToken: async () => { // Hook que se ejecuta antes de autorizar la subida
        const { userId } = await auth();   // Verifica la sesión del usuario

        if (!userId) {
          throw new Error('Unauthorized: User not authenticated'); // Bloquea usuarios no logueados
        }

        return {
          allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_FILE_SIZE,
          tokenPayload: JSON.stringify({ userId })                // Guarda metadatos en el token para usarlos al completar
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {      // Hook que se ejecuta cuando la subida finaliza exitosamente
        console.log('File uploaded to blob: ', blob.url)          // Aquí podrías guardar la URL en BD si no lo hicieras en el cliente

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