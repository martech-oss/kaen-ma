export * from "./contract";
export * from "./shared/errors";
export * from "./assets/contract";
export * from "./automations/contract";
export * from "./consent/contract";
export * from "./contacts/contract";
export * from "./contacts/resource-contract";
export * from "./contacts/company-contract";
export * from "./operations/contract";
export * from "./projects/contract";
export * from "./segments/contract";
export * from "./workspaces/contract";

// Compatibility surface while the application migrates to domain-specific
// @openengage/core imports. API consumers should import domain types from the
// SDK rather than this internal contract package.
export * from "@openengage/core";
