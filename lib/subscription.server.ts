import { auth } from "@clerk/nextjs/server";
import { PLANS, PLAN_LIMITS, PlanType } from "@/lib/subscription-constants";

export const getUserPlan = async (): Promise<PlanType> => {
  const { has, userId } = await auth();                                        // Obtiene la sesión y utilidades de autorización de Clerk

  if (!userId) return PLANS.FREE;                                              // Si no hay usuario logueado, asigna el plan gratuito por defecto

  if (has({ plan: "pro" })) return PLANS.PRO;                                  // Verifica si el usuario tiene asignado el plan "pro" en los metadatos de Clerk
  if (has({ plan: "standard" })) return PLANS.STANDARD;                        // Verifica si el usuario tiene asignado el plan "standard"

  return PLANS.FREE;                                                           // Fallback al plan gratuito si no se detectan planes de pago
}

export const getPlanLimits = async () => {                                     // Obtiene los límites de un plan
  const plan = await getUserPlan();                                            // Obtiene el plan del usuario
  return PLAN_LIMITS[plan];                                                    // Retorna los límites del plan
}