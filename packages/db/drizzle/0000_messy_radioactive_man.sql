CREATE TABLE "platform_meta" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"schema_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
