'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload, ImageIcon } from 'lucide-react';
import { UploadSchema } from '@/lib/zod';
import { BookUploadFormValues } from '@/types';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ACCEPTED_PDF_TYPES, ACCEPTED_IMAGE_TYPES, DEFAULT_VOICE } from '@/lib/constants';
import FileUploader from './FileUploader';
import VoiceSelector from './VoiceSelector';
import LoadingOverlay from './LoadingOverlay';
import { useAuth, useUser } from "@clerk/nextjs";
import { toast } from 'sonner';
import { checkBookExists, createBook, saveBookSegments } from "@/lib/actions/book.actions";
import { useRouter } from "next/navigation";
import { parsePDFFile } from "@/lib/utils";
import { upload } from "@vercel/blob/client";

const UploadForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const { userId } = useAuth();
  const router = useRouter()

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const form = useForm<BookUploadFormValues>({                                 // Inicializa el formulario con React Hook Form
    resolver: zodResolver(UploadSchema),                                       // Conecta la validación de Zod con el formulario
    defaultValues: {
      title: '',                                                               // Valores iniciales para evitar errores de componentes no controlados
      author: '',
      persona: '',
      pdfFile: undefined,
      coverImage: undefined,
    },
  });

  const onSubmit = async (data: BookUploadFormValues) => {
    if (!userId) {                                                             // Verifica autenticación antes de procesar
      return toast.error("Please login to upload books");
    }

    setIsSubmitting(true);                                                     // Activa estado de carga para deshabilitar inputs y mostrar overlay

    // PostHog -> Track Book Uploads...

    try {
      const existsCheck = await checkBookExists(data.title);                   // Verifica si el libro ya existe en la BD

      if (existsCheck.exists && existsCheck.book) {                            // Si existe, redirige al usuario al libro existente
        toast.info("Book with same title already exists.");
        form.reset()
        router.push(`/books/${existsCheck.book.slug}`)
        return;
      }

      const fileTitle = data.title.replace(/\s+/g, '-').toLowerCase();         // Normaliza el título para nombres de archivo
      const pdfFile = data.pdfFile;

      const parsedPDF = await parsePDFFile(pdfFile);                           // Procesa el PDF localmente: extrae texto y genera portada

      if (parsedPDF.content.length === 0) {                                    // Valida que el PDF tenga contenido de texto extraíble
        toast.error("Failed to parse PDF. Please try again with a different file.");
        return;
      }

      const uploadedPdfBlob = await upload(fileTitle, pdfFile, {               // Sube el PDF a Vercel Blob Storage
        access: 'public',
        handleUploadUrl: '/api/upload',
        contentType: 'application/pdf'                                         // Asegura el tipo de contenido correcto
      });

      let coverUrl: string;

      if (data.coverImage) {                                                   // Si el usuario subió una portada personalizada
        const coverFile = data.coverImage;
        const uploadedCoverBlob = await upload(`${fileTitle}_cover.png`, coverFile, { // Sube la imagen personalizada
          access: 'public',
          handleUploadUrl: '/api/upload',
          contentType: coverFile.type
        });
        coverUrl = uploadedCoverBlob.url;
      } else {                                                                // Si no, usa la portada generada desde la primera página del PDF
        const response = await fetch(parsedPDF.cover)                         // Convierte Data URL a Blob para subirlo
        const blob = await response.blob();

        const uploadedCoverBlob = await upload(`${fileTitle}_cover.png`, blob, { // Sube la portada generada
          access: 'public',
          handleUploadUrl: '/api/upload',
          contentType: 'image/png'
        });
        coverUrl = uploadedCoverBlob.url;
      }

      const book = await createBook({                                        // Crea el registro del libro en MongoDB
        clerkId: userId,
        title: data.title,
        author: data.author,
        persona: data.persona,
        fileURL: uploadedPdfBlob.url,
        fileBlobKey: uploadedPdfBlob.pathname,
        coverURL: coverUrl,
        fileSize: pdfFile.size,
      });

      if (!book.success) {
        toast.error(book.error as string || "Failed to create book");        // Maneja errores de creación (ej. límites del plan)
        if (book.isBillingError) {                                           // Redirige a suscripciones si es error de facturación
          router.push("/subscriptions");
        }
        return;
      }

      if (book.alreadyExists) {                                              // Doble verificación por si se creó concurrentemente
        toast.info("Book with same title already exists.");
        form.reset()
        router.push(`/books/${book.data.slug}`)
        return;
      }

      const segments = await saveBookSegments(book.data._id, userId, parsedPDF.content); // Guarda los segmentos de texto para búsqueda vectorial/full-text

      if (!segments.success) {
        toast.error("Failed to save book segments");
        throw new Error("Failed to save book segments");
      }

      form.reset();                                                         // Limpia el formulario
      router.push('/');                                                     // Redirige a la biblioteca principal
    } catch (error) {
      console.error(error);

      toast.error("Failed to upload book. Please try again later.");       // Manejo genérico de errores
    } finally {
      setIsSubmitting(false);                                              // Restaura el estado del formulario
    }
  };

  if (!isMounted) return null;                                             // Evita problemas de hidratación en SSR

  return (
    <>
      {isSubmitting && <LoadingOverlay />}                                {/* Muestra overlay de carga bloqueante durante el proceso */}

      <div className="new-book-wrapper">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* 1. PDF File Upload */}
            <FileUploader
              control={form.control}
              name="pdfFile"
              label="Book PDF File"
              acceptTypes={ACCEPTED_PDF_TYPES}
              icon={Upload}
              placeholder="Click to upload PDF"
              hint="PDF file (max 50MB)"
              disabled={isSubmitting}
            />

            {/* 2. Cover Image Upload */}
            <FileUploader
              control={form.control}
              name="coverImage"
              label="Cover Image (Optional)"
              acceptTypes={ACCEPTED_IMAGE_TYPES}
              icon={ImageIcon}
              placeholder="Click to upload cover image"
              hint="Leave empty to auto-generate from PDF"
              disabled={isSubmitting}
            />

            {/* 3. Title Input */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="form-label">Title</FormLabel>
                  <FormControl>
                    <Input
                      className="form-input"
                      placeholder="ex: Rich Dad Poor Dad"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 4. Author Input */}
            <FormField
              control={form.control}
              name="author"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="form-label">Author Name</FormLabel>
                  <FormControl>
                    <Input
                      className="form-input"
                      placeholder="ex: Robert Kiyosaki"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 5. Voice Selector */}
            <FormField
              control={form.control}
              name="persona"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="form-label">Choose Assistant Voice</FormLabel>
                  <FormControl>
                    <VoiceSelector
                      value={field.value}
                      onChange={field.onChange}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 6. Submit Button */}
            <Button type="submit" className="form-btn" disabled={isSubmitting}>
              Begin Synthesis
            </Button>
          </form>
        </Form>
      </div>
    </>
  );
};

export default UploadForm;