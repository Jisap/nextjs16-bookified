import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;                                  // Obtiene la URI de conexión de las variables de entorno

if (!MONGODB_URI) throw new Error('Please define the MONGODB_URI environment variable'); // Valida que la URI esté definida

declare global {                                                              // Extiende el objeto global de NodeJS para persistir la conexión en recargas (hot-reload)
  var mongooseCache: {
    conn: typeof mongoose | null                                              // Almacena la conexión activa si existe
    promise: Promise<typeof mongoose> | null                                  // Almacena la promesa de conexión pendiente
  }
}

// Inicializa la caché global para evitar saturar 
// la BD con conexiones en modo desarrollo
let cached = global.mongooseCache
  || (global.mongooseCache = { conn: null, promise: null });

export const connectToDatabase = async () => {                                 // Función Singleton para conectar a la base de datos
  if (cached.conn) return cached.conn;                                         // Si ya hay conexión activa, la reutiliza inmediatamente

  if (!cached.promise) {                                                       // Si no hay promesa de conexión, inicia una nueva
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false }); // bufferCommands: false evita encolar operaciones si no hay conexión
  }

  try {
    cached.conn = await cached.promise;                                        // Espera a que la promesa se resuelva y guarda la conexión
  } catch (e) {
    cached.promise = null;                                                     // Resetea la promesa si falla para permitir reintentos futuros
    console.error('MongoDB connection error. Please make sure MongoDB is running. ' + e); // Loguea el error crítico
    throw e;                                                                   // Relanza el error para que la aplicación lo maneje
  }

  console.info('Connected to MongoDB');                                        // Confirma conexión exitosa en consola
  return cached.conn;                                                          // Retorna la instancia de conexión
}