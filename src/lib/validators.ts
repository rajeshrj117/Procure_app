import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(72),
  portal: z.enum(["company", "vendor"]),
});

export const registerSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required.").max(140),
  name: z.string().trim().min(2, "Your name is required.").max(80),
  email: z.string().trim().email("Enter a valid work email."),
  password: z.string().min(8, "Use at least 8 characters.").max(72),
  city: z.string().trim().min(2, "City is required.").max(80),
  country: z.string().trim().min(2).max(80),
});

export const itemSchema = z.object({
  productName: z.string().trim().min(2, "Product name is required.").max(160),
  category: z.string().trim().max(80).optional().nullable(),
  grade: z.string().trim().max(80).optional().nullable(),
  specifications: z.string().trim().max(1000).optional().nullable(),
  quantity: z.number().positive("Quantity must be greater than zero.").optional().nullable(),
  unit: z.string().trim().max(24).optional().nullable(),
  targetPriceRupees: z.number().nonnegative().optional().nullable(),
  deliveryNotes: z.string().trim().max(400).optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  needsReview: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  extractionNote: z.string().max(400).optional().nullable(),
});

export const requestSchema = z.object({
  title: z.string().trim().min(3, "Add a requirement title.").max(180),
  description: z.string().trim().max(4000).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  deliveryLocation: z.string().trim().max(240).optional().nullable(),
  expectedDeliveryDate: z.string().optional().nullable(),
  maxBudgetRupees: z.number().nonnegative().optional().nullable(),
  currency: z.string().trim().max(8).optional(),
  taxPercent: z.number().min(0).max(100).optional().nullable(),
  visibilityMode: z.enum(["open", "anonymous", "blind", "company_only"]).optional(),
  terms: z.string().trim().max(8000).optional().nullable(),
  workflow: z.enum(["manual", "discovery", "document", "bidding", "negotiation"]).optional(),
  items: z.array(itemSchema).min(1, "Add at least one product line."),
});

export const vendorSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactPerson: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(240).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(80).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  categories: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  grades: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  gstNumber: z.string().trim().max(20).optional().nullable(),
  paymentTerms: z.string().trim().max(160).optional().nullable(),
  deliveryCapabilities: z.string().trim().max(400).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  verificationStatus: z.enum(["unverified", "pending", "verified", "rejected"]).optional(),
  performanceScore: z.number().min(0).max(100).optional(),
  onTimeDeliveryRate: z.number().min(0).max(100).optional(),
  active: z.boolean().optional(),
  source: z.string().trim().max(400).optional().nullable(),
});

export const catalogSchema = z.object({
  vendorId: z.string().min(3),
  productName: z.string().trim().min(2).max(160),
  category: z.string().trim().max(80).optional().nullable(),
  grade: z.string().trim().max(80).optional().nullable(),
  specifications: z.string().trim().max(1000).optional().nullable(),
  availableQty: z.number().nonnegative().optional().nullable(),
  unit: z.string().trim().max(24).optional().nullable(),
  priceRupees: z.number().positive("Quoted price must be greater than zero."),
  moq: z.number().nonnegative().optional().nullable(),
  deliveryDays: z.number().int().nonnegative().optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  source: z.string().trim().max(400).optional().nullable(),
});

export const inviteSchema = z.object({
  vendorIds: z.array(z.string()).min(1, "Select at least one supplier."),
  startsAt: z.string().min(4),
  endsAt: z.string().min(4),
  visibilityMode: z.enum(["open", "anonymous", "blind", "company_only"]),
  minIncrementRupees: z.number().nonnegative(),
  terms: z.string().max(8000).optional().nullable(),
  resend: z.boolean().optional(),
});

export const bidSchema = z.object({
  amountRupees: z.number().positive("Enter a price greater than zero."),
  note: z.string().max(1000).optional().nullable(),
  isFinal: z.boolean().optional(),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: "Accept the terms before submitting a bid." }) }),
});

export const extensionSchema = z.object({
  reason: z.string().trim().min(8, "Add a short reason.").max(500),
  requestedMinutes: z.number().int().min(15).max(10080),
  message: z.string().trim().max(1000).optional().nullable(),
});

export const extensionReviewSchema = z.object({
  decision: z.enum(["approve", "reject", "clarification"]),
  note: z.string().trim().max(1000).optional().nullable(),
  approvedMinutes: z.number().int().min(15).max(10080).optional(),
  rescheduleStart: z.string().optional().nullable(),
});

export const negotiationStartSchema = z.object({
  vendorId: z.string().min(3),
  offerRupees: z.number().positive(),
  message: z.string().trim().min(2).max(2000),
});

export const negotiationMessageSchema = z.object({
  action: z.enum(["offer", "counter", "accept", "reject", "message", "confirm"]),
  message: z.string().trim().min(1).max(2000),
  offerRupees: z.number().positive().optional().nullable(),
});

export const userSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["company_admin", "procurement_manager", "procurement_staff"]),
  title: z.string().trim().max(80).optional().nullable(),
});

export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  vendorCount: z.number().int().min(1).max(5),
  strategy: z.enum(["aggressive", "competitive", "conservative", "fixed_margin", "randomized"]),
  speedSeconds: z.number().int().min(8).max(300),
  minPriceRupees: z.number().nonnegative().optional().nullable(),
  maxDiscountPercent: z.number().min(1).max(40),
});
