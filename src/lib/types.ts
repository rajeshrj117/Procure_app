export type Role = "super_admin" | "company_admin" | "procurement_manager" | "procurement_staff" | "vendor";

export type Interpretation = {
  product: string | null;
  grade: string | null;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  maxDistanceKm: number | null;
  category: string | null;
  specifications: string | null;
};

export type CompanyProfile = {
  id: string;
  name: string;
  legalName: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string;
  currency: string;
  timezone: string;
  taxPercent: number;
  isDemo: boolean;
  defaultVisibility: string;
  minBidIncrementPaise: number;
  gstNumber: string | null;
  emailFromName: string | null;
  hasDirectoryToken: boolean;
  directoryWebhookUrl: string | null;
};

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  phone: string | null;
  title: string | null;
};

export type VendorDto = {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  categories: string[];
  grades: string[];
  gstNumber: string | null;
  verificationStatus: string;
  performanceScore: number;
  onTimeDeliveryRate: number;
  paymentTerms: string | null;
  deliveryCapabilities: string | null;
  active: boolean;
  isSimulated: boolean;
  simulationKind: string | null;
  badge: string | null;
  portalEnabled: boolean;
  source: string | null;
  lastVerifiedAt: string | null;
  notes: string | null;
  createdAt: string;
};

export type CatalogDto = {
  id: string;
  vendorId: string;
  productName: string;
  category: string | null;
  grade: string | null;
  specifications: string | null;
  availableQty: number | null;
  unit: string | null;
  pricePaise: number;
  currency: string;
  moq: number | null;
  deliveryDays: number | null;
  rating: number | null;
  source: string | null;
  lastVerifiedAt: string | null;
  isSimulated: boolean;
};

export type DiscoverRow = {
  catalogId: string | null;
  vendorId: string | null;
  externalId: string | null;
  vendorName: string;
  city: string | null;
  state: string | null;
  country: string | null;
  productName: string;
  grade: string | null;
  specifications: string | null;
  availableQty: number | null;
  unit: string | null;
  pricePaise: number;
  distanceKm: number | null;
  deliveryDays: number | null;
  rating: number | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  priceUpdatedAt: string | null;
  source: string | null;
  lastVerifiedAt: string | null;
  badge: string | null;
  simulationKind: string | null;
  performanceScore: number | null;
  moq: number | null;
  origin: "workspace" | "integration";
};

export type ItemDto = {
  id: string;
  productName: string;
  category: string | null;
  grade: string | null;
  specifications: string | null;
  quantity: number | null;
  unit: string | null;
  targetPricePaise: number | null;
  deliveryNotes: string | null;
  confidence: number | null;
  needsReview: boolean;
  confirmed: boolean;
  extractionNote: string | null;
  sortOrder: number;
};

export type RequestDto = {
  id: string;
  referenceCode: string;
  title: string;
  status: string;
  workflow: string;
  description: string | null;
  category: string | null;
  deliveryLocation: string | null;
  deliveryCity: string | null;
  expectedDeliveryDate: string | null;
  targetPricePaise: number | null;
  maxBudgetPaise: number | null;
  currency: string;
  taxPercent: number | null;
  visibilityMode: string;
  terms: string | null;
  baselinePaise: number | null;
  baselineLabel: string | null;
  awardedVendorId: string | null;
  awardedPaise: number | null;
  awardedAt: string | null;
  savingsPaise: number | null;
  savingsPercent: number | null;
  awardMode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvitationDto = {
  id: string;
  vendorId: string;
  vendorName: string;
  badge: string | null;
  email: string;
  token: string | null;
  status: string;
  emailStatus: string;
  simulationOnly: boolean;
  sentAt: string | null;
  openedAt: string | null;
  expiresAt: string | null;
};

export type RankRow = {
  rank: number;
  vendorId: string;
  vendorName: string;
  badge: string | null;
  amountPaise: number;
  bidId: string;
  submittedAt: string;
  isFinal: boolean;
  status: string;
  simulationKind: string | null;
  isYou?: boolean;
};

export type BidDto = {
  id: string;
  vendorId: string;
  vendorName: string;
  badge: string | null;
  amountPaise: number;
  note: string | null;
  isSimulated: boolean;
  isFinal: boolean;
  createdAt: string;
};

export type ExtensionDto = {
  id: string;
  vendorId: string;
  vendorName: string;
  reason: string;
  requestedMinutes: number;
  message: string | null;
  status: string;
  companyNote: string | null;
  approvedMinutes: number | null;
  previousEndsAt: string | null;
  newEndsAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type SessionDto = {
  id: string;
  status: string;
  phase: string;
  startsAt: string;
  endsAt: string;
  originalEndsAt: string | null;
  visibilityMode: string;
  minIncrementPaise: number;
  currency: string;
  extensionCount: number;
  closedAt: string | null;
};

export type NegotiationDto = {
  id: string;
  requestId: string;
  vendorId: string;
  vendorName: string;
  badge: string | null;
  status: string;
  vendorToken: string | null;
  agreedPaise: number | null;
  agreedAt: string | null;
  currency: string;
  createdAt: string;
  messages: NegotiationMessageDto[];
  disclaimer: string | null;
};

export type NegotiationMessageDto = {
  id: string;
  senderRole: string;
  senderName: string;
  body: string;
  offerPaise: number | null;
  action: string;
  createdAt: string;
};

export type ActivityDto = {
  id: string;
  actorType: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type DocumentDto = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  extractionStatus: string;
  scanStatus: string;
  createdAt: string;
  requestId: string | null;
  vendorId: string | null;
};
