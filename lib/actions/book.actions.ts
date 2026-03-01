'use server';

import { CreateBook, TextSegment } from "@/types";
import { connectToDatabase } from "@/database/mongoose";
import { escapeRegex, generateSlug, serializeData } from "@/lib/utils";
import Book from "@/database/models/book.model";
import BookSegment from "@/database/models/book-segment.model";
import mongoose from "mongoose";
import { getUserPlan } from "@/lib/subscription.server";

export const getAllBooks = async (search?: string) => {
  try {
    await connectToDatabase();                                           // Conecta a la base de datos

    let query = {};

    if (search) {
      const escapedSearch = escapeRegex(search);                         // Escapa caracteres especiales para regex
      const regex = new RegExp(escapedSearch, 'i');                      // Crea expresión regular insensible a mayúsculas
      query = {
        $or: [
          { title: { $regex: regex } },                                  // Busca coincidencias en el título
          { author: { $regex: regex } },                                 // Busca coincidencias en el autor
        ]
      };
    }

    const books = await Book.find(query).sort({ createdAt: -1 }).lean(); // Obtiene libros ordenados por fecha (lean para rendimiento)

    return {
      success: true,
      data: serializeData(books)                                         // Serializa los datos para enviarlos al cliente
    }
  } catch (e) {
    console.error('Error connecting to database', e);
    return {
      success: false, error: e
    }
  }
}

export const checkBookExists = async (title: string) => {
  try {
    await connectToDatabase();

    const slug = generateSlug(title);                                    // Genera un slug URL-friendly del título

    const existingBook = await Book.findOne({ slug }).lean();            // Verifica si ya existe un libro con ese slug

    if (existingBook) {
      return {
        exists: true,
        book: serializeData(existingBook)
      }
    }

    return {
      exists: false,
    }
  } catch (e) {
    console.error('Error checking book exists', e);
    return {
      exists: false, error: e
    }
  }
}

export const createBook = async (data: CreateBook) => {
  try {
    await connectToDatabase();

    const slug = generateSlug(data.title);                                // Genera slug del título

    const existingBook = await Book.findOne({ slug }).lean();             // Busca por slug para evitar duplicados

    if (existingBook) {
      return {
        success: true,
        data: serializeData(existingBook),
        alreadyExists: true,
      }
    }

    // Todo: Check subscription limits before creating a book
    const { getUserPlan } = await import("@/lib/subscription.server");     // Importación dinámica para evitar dependencias circulares
    const { PLAN_LIMITS } = await import("@/lib/subscription-constants");

    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();                                       // Obtiene el ID del usuario autenticado

    if (!userId || userId !== data.clerkId) {
      return { success: false, error: "Unauthorized" };
    }

    const plan = await getUserPlan();                                      // Obtiene el plan actual del usuario
    const limits = PLAN_LIMITS[plan];                                      // Obtiene los límites del plan

    const bookCount = await Book.countDocuments({ clerkId: userId });      // Cuenta los libros creados por el usuario

    if (bookCount >= limits.maxBooks) {                                    // Verifica si excede el límite
      const { revalidatePath } = await import("next/cache");
      revalidatePath("/");

      return {
        success: false,
        error: `You have reached the maximum number of books allowed for your ${plan} plan (${limits.maxBooks}). Please upgrade to add more books.`,
        isBillingError: true,
      };
    }

    const book = await Book.create({ ...data, clerkId: userId, slug, totalSegments: 0 }); // Crea el nuevo libro en la BD

    return {
      success: true,
      data: serializeData(book),
    }
  } catch (e) {
    console.error('Error creating a book', e);

    return {
      success: false,
      error: e,
    }
  }
}

export const getBookBySlug = async (slug: string) => {
  try {
    await connectToDatabase();

    const book = await Book.findOne({ slug }).lean();              // Busca un libro específico por su slug

    if (!book) {
      return { success: false, error: 'Book not found' };
    }

    return {
      success: true,
      data: serializeData(book)
    }
  } catch (e) {
    console.error('Error fetching book by slug', e);
    return {
      success: false, error: e
    }
  }
}

export const saveBookSegments = async (bookId: string, clerkId: string, segments: TextSegment[]) => {
  try {
    await connectToDatabase();

    console.log('Saving book segments...');

    // Prepara los segmentos para inserción masiva
    const segmentsToInsert = segments.map(({ text, segmentIndex, pageNumber, wordCount }) => ({
      clerkId, bookId, content: text, segmentIndex, pageNumber, wordCount
    }));

    await BookSegment.insertMany(segmentsToInsert);                           // Inserta todos los segmentos en una sola operación

    await Book.findByIdAndUpdate(bookId, { totalSegments: segments.length }); // Actualiza el contador de segmentos del libro

    console.log('Book segments saved successfully.');

    return {
      success: true,
      data: { segmentsCreated: segments.length }
    }
  } catch (e) {
    console.error('Error saving book segments', e);

    return {
      success: false,
      error: e,
    }
  }
}

// Searches book segments using MongoDB text search with regex fallback
export const searchBookSegments = async (bookId: string, query: string, limit: number = 5) => {
  try {
    await connectToDatabase();

    console.log(`Searching for: "${query}" in book ${bookId}`);

    const bookObjectId = new mongoose.Types.ObjectId(bookId);      // Convierte string ID a ObjectId de Mongoose

    // Try MongoDB text search first (requires text index)
    let segments: Record<string, unknown>[] = [];
    try {
      segments = await BookSegment.find({
        bookId: bookObjectId,
        $text: { $search: query },                                 // Intenta búsqueda de texto completo indexada (más rápida/inteligente)
      })
        .select('_id bookId content segmentIndex pageNumber wordCount')
        .sort({ score: { $meta: 'textScore' } })                   // Ordena por relevancia
        .limit(limit)
        .lean();
    } catch {
      // Text index may not exist — fall through to regex fallback
      segments = [];
    }

    // Fallback: regex search matching ANY keyword
    if (segments.length === 0) {
      const keywords = query.split(/\s+/).filter((k) => k.length > 2); // Filtra palabras cortas
      const pattern = keywords.map(escapeRegex).join('|');         // Crea patrón OR para regex

      segments = await BookSegment.find({
        bookId: bookObjectId,
        content: { $regex: pattern, $options: 'i' },               // Búsqueda regex como respaldo si falla la de texto
      })
        .select('_id bookId content segmentIndex pageNumber wordCount')
        .sort({ segmentIndex: 1 })
        .limit(limit)
        .lean();
    }

    console.log(`Search complete. Found ${segments.length} results`);

    return {
      success: true,
      data: serializeData(segments),
    };
  } catch (error) {
    console.error('Error searching segments:', error);
    return {
      success: false,
      error: (error as Error).message,
      data: [],
    };
  }
};