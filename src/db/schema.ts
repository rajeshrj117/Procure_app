import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type AiProfile = {
  strategy: "aggressive" | "competitive" | "conservative" | "fixed_margin" | "randomized";
  floorFactor: number;
  anchorFactor: number;
  maxBids: number;
};

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  industry: text("industry"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  country: text("country").notNull().default("India"),
  gstNumber: text("gst_number"),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).notNull().default("18"),
  bidsIncludeTax: boolean("bids_include_tax").notNull().default(false),
  defaultVisibility: text("default_visibility").notNull().default("anonymous"),
  minBidIncrementPaise: integer("min_bid_increment_paise").notNull().default(10000),
  emailFromName: text("email_from_name"),
  directoryWebhookUrl: text("directory_webhook_url"),
  directoryWebhookToken: text("directory_webhook_token"),
  isDemo: boolean("is_demo").notNull().default(false),
  nextRequestNumber: integer("next_request_number").notNull().default(1000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    phone: text("phone"),
    title: text("title"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), index("users_company_idx").on(t.companyId)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    actorType: text("actor_type").notNull(),
    userId: text("user_id"),
    vendorId: text("vendor_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auth_sessions_token_idx").on(t.tokenHash)],
);

export const vendors = pgTable(
  "vendors",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    email: text("email").notNull(),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    country: text("country").notNull().default("India"),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    categories: jsonb("categories").$type<string[]>(),
    grades: jsonb("grades").$type<string[]>(),
    gstNumber: text("gst_number"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    performanceScore: integer("performance_score").notNull().default(0),
    onTimeDeliveryRate: integer("on_time_delivery_rate").notNull().default(0),
    paymentTerms: text("payment_terms"),
    deliveryCapabilities: text("delivery_capabilities"),
    active: boolean("active").notNull().default(true),
    isSimulated: boolean("is_simulated").notNull().default(false),
    simulationKind: text("simulation_kind"),
    portalPasswordHash: text("portal_password_hash"),
    portalEnabled: boolean("portal_enabled").notNull().default(false),
    source: text("source"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    notes: text("notes"),
    aiProfile: jsonb("ai_profile").$type<AiProfile>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vendors_company_idx").on(t.companyId),
    uniqueIndex("vendors_email_idx").on(t.email),
  ],
);

export const vendorCatalog = pgTable(
  "vendor_catalog",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendors.id),
    productName: text("product_name").notNull(),
    category: text("category"),
    grade: text("grade"),
    specifications: text("specifications"),
    availableQty: numeric("available_qty", { precision: 14, scale: 3 }),
    unit: text("unit"),
    pricePaise: integer("price_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    moq: numeric("moq", { precision: 14, scale: 3 }),
    deliveryDays: integer("delivery_days"),
    ratingTenths: integer("rating_tenths"),
    source: text("source"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    isSimulated: boolean("is_simulated").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("catalog_vendor_idx").on(t.vendorId), index("catalog_company_idx").on(t.companyId)],
);

export const procurementRequests = pgTable(
  "procurement_requests",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    createdBy: text("created_by"),
    referenceCode: text("reference_code").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    workflow: text("workflow").notNull().default("manual"),
    description: text("description"),
    category: text("category"),
    deliveryLocation: text("delivery_location"),
    deliveryCity: text("delivery_city"),
    expectedDeliveryDate: timestamp("expected_delivery_date", { withTimezone: true }),
    targetPricePaise: integer("target_price_paise"),
    maxBudgetPaise: integer("max_budget_paise"),
    currency: text("currency").notNull().default("INR"),
    taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }),
    visibilityMode: text("visibility_mode").notNull().default("anonymous"),
    terms: text("terms"),
    baselinePaise: integer("baseline_paise"),
    baselineLabel: text("baseline_label"),
    awardedVendorId: text("awarded_vendor_id"),
    awardedBidId: text("awarded_bid_id"),
    awardedPaise: integer("awarded_paise"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }),
    savingsPaise: integer("savings_paise"),
    savingsPercent: numeric("savings_percent", { precision: 8, scale: 3 }),
    awardMode: text("award_mode"),
    excludedVendorIds: jsonb("excluded_vendor_ids").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("requests_company_idx").on(t.companyId),
    uniqueIndex("requests_ref_idx").on(t.companyId, t.referenceCode),
  ],
);

export const requirementItems = pgTable(
  "requirement_items",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    companyId: text("company_id").notNull(),
    productName: text("product_name").notNull(),
    category: text("category"),
    grade: text("grade"),
    specifications: text("specifications"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }),
    unit: text("unit"),
    targetPricePaise: integer("target_price_paise"),
    deliveryNotes: text("delivery_notes"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    needsReview: boolean("needs_review").notNull().default(true),
    confirmed: boolean("confirmed").notNull().default(false),
    sourceDocumentId: text("source_document_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    extractionNote: text("extraction_note"),
  },
  (t) => [index("items_request_idx").on(t.requestId)],
);

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  requestId: text("request_id"),
  vendorId: text("vendor_id"),
  uploadedBy: text("uploaded_by"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull(),
  extractedText: text("extracted_text"),
  extractionJson: jsonb("extraction_json"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  scanStatus: text("scan_status").notNull().default("not_configured"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const biddingSessions = pgTable(
  "bidding_sessions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    requestId: text("request_id").notNull(),
    status: text("status").notNull().default("scheduled"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    originalEndsAt: timestamp("original_ends_at", { withTimezone: true }),
    visibilityMode: text("visibility_mode").notNull().default("anonymous"),
    minIncrementPaise: integer("min_increment_paise").notNull().default(10000),
    currency: text("currency").notNull().default("INR"),
    extensionCount: integer("extension_count").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_request_idx").on(t.requestId), index("sessions_company_idx").on(t.companyId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    requestId: text("request_id").notNull(),
    sessionId: text("session_id"),
    vendorId: text("vendor_id").notNull(),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    emailStatus: text("email_status").notNull().default("pending"),
    simulationOnly: boolean("simulation_only").notNull().default(false),
    simAnchorPaise: integer("sim_anchor_paise"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_idx").on(t.token),
    index("invitations_request_idx").on(t.requestId),
    index("invitations_vendor_idx").on(t.vendorId),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    sessionId: text("session_id").notNull(),
    requestId: text("request_id").notNull(),
    vendorId: text("vendor_id").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    note: text("note"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    isFinal: boolean("is_final").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bids_session_idx").on(t.sessionId), index("bids_vendor_idx").on(t.vendorId)],
);

export const extensionRequests = pgTable(
  "extension_requests",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    sessionId: text("session_id").notNull(),
    requestId: text("request_id").notNull(),
    vendorId: text("vendor_id").notNull(),
    reason: text("reason").notNull(),
    requestedMinutes: integer("requested_minutes").notNull(),
    message: text("message"),
    status: text("status").notNull().default("pending"),
    companyNote: text("company_note"),
    approvedMinutes: integer("approved_minutes"),
    previousEndsAt: timestamp("previous_ends_at", { withTimezone: true }),
    newEndsAt: timestamp("new_ends_at", { withTimezone: true }),
    previousStartsAt: timestamp("previous_starts_at", { withTimezone: true }),
    newStartsAt: timestamp("new_starts_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("extensions_session_idx").on(t.sessionId)],
);

export const negotiations = pgTable(
  "negotiations",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    requestId: text("request_id").notNull(),
    vendorId: text("vendor_id").notNull(),
    status: text("status").notNull().default("open"),
    currency: text("currency").notNull().default("INR"),
    vendorToken: text("vendor_token").notNull(),
    createdBy: text("created_by"),
    agreedPaise: integer("agreed_paise"),
    agreedAt: timestamp("agreed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("negotiations_token_idx").on(t.vendorToken),
    index("negotiations_request_idx").on(t.requestId),
  ],
);

export const negotiationMessages = pgTable(
  "negotiation_messages",
  {
    id: text("id").primaryKey(),
    negotiationId: text("negotiation_id").notNull(),
    companyId: text("company_id").notNull(),
    senderRole: text("sender_role").notNull(),
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    offerPaise: integer("offer_paise"),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("neg_messages_idx").on(t.negotiationId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    userId: text("user_id"),
    vendorId: text("vendor_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    type: text("type").notNull(),
    href: text("href"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId), index("notifications_vendor_idx").on(t.vendorId)],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_company_idx").on(t.companyId, t.createdAt)],
);

export const emailLogs = pgTable(
  "email_logs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text").notNull(),
    status: text("status").notNull(),
    provider: text("provider"),
    error: text("error"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_company_idx").on(t.companyId)],
);

export const aiConfigs = pgTable("ai_configs", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => companies.id),
  enabled: boolean("enabled").notNull().default(false),
  vendorCount: integer("vendor_count").notNull().default(4),
  strategy: text("strategy").notNull().default("competitive"),
  speedSeconds: integer("speed_seconds").notNull().default(20),
  minPricePaise: integer("min_price_paise"),
  maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale: 2 }).notNull().default("12"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiActivities = pgTable(
  "ai_activities",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    vendorId: text("vendor_id"),
    sessionId: text("session_id"),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_activity_company_idx").on(t.companyId)],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    vendorId: text("vendor_id").notNull(),
    productName: text("product_name").notNull(),
    pricePaise: integer("price_paise").notNull(),
    unit: text("unit"),
    source: text("source"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_history_vendor_idx").on(t.vendorId)],
);

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
