/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as amScope from "../amScope.js";
import type * as appUrl from "../appUrl.js";
import type * as assetManagers from "../assetManagers.js";
import type * as audit from "../audit.js";
import type * as auditEntities from "../auditEntities.js";
import type * as authz from "../authz.js";
import type * as board from "../board.js";
import type * as calendarView from "../calendarView.js";
import type * as clerkWebhook from "../clerkWebhook.js";
import type * as conversations from "../conversations.js";
import type * as coreQuestions from "../coreQuestions.js";
import type * as counters from "../counters.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demoSeed from "../demoSeed.js";
import type * as docs from "../docs.js";
import type * as docsImport from "../docsImport.js";
import type * as elevenLabsApi from "../elevenLabsApi.js";
import type * as exceptionOrder from "../exceptionOrder.js";
import type * as feeMigration from "../feeMigration.js";
import type * as feeSettings from "../feeSettings.js";
import type * as feeSettingsLib from "../feeSettingsLib.js";
import type * as financeAccess from "../financeAccess.js";
import type * as geminiApi from "../geminiApi.js";
import type * as googleApi from "../googleApi.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as http from "../http.js";
import type * as jobRoles from "../jobRoles.js";
import type * as leadScoring from "../leadScoring.js";
import type * as leads from "../leads.js";
import type * as ledger from "../ledger.js";
import type * as ledgerAccountSeed from "../ledgerAccountSeed.js";
import type * as ledgerAccounts from "../ledgerAccounts.js";
import type * as maintenance from "../maintenance.js";
import type * as maintenanceReasons from "../maintenanceReasons.js";
import type * as notifications from "../notifications.js";
import type * as notify from "../notify.js";
import type * as orgMigration from "../orgMigration.js";
import type * as orgSettings from "../orgSettings.js";
import type * as otlp from "../otlp.js";
import type * as ownerIdentity from "../ownerIdentity.js";
import type * as ownerLinking from "../ownerLinking.js";
import type * as ownerRouting from "../ownerRouting.js";
import type * as ownerRoutingLib from "../ownerRoutingLib.js";
import type * as ownerStatements from "../ownerStatements.js";
import type * as ownerTransfer from "../ownerTransfer.js";
import type * as ownerVerifyLib from "../ownerVerifyLib.js";
import type * as owners from "../owners.js";
import type * as ownersImport from "../ownersImport.js";
import type * as ownersImportLib from "../ownersImportLib.js";
import type * as phone from "../phone.js";
import type * as photoEmails from "../photoEmails.js";
import type * as places from "../places.js";
import type * as placesApi from "../placesApi.js";
import type * as probeFixtures from "../probeFixtures.js";
import type * as promptMigration from "../promptMigration.js";
import type * as properties from "../properties.js";
import type * as publicLinks from "../publicLinks.js";
import type * as qualifications from "../qualifications.js";
import type * as qualifyRules from "../qualifyRules.js";
import type * as questionFlowLib from "../questionFlowLib.js";
import type * as ratings from "../ratings.js";
import type * as rentPayments from "../rentPayments.js";
import type * as rentPaymentsLib from "../rentPaymentsLib.js";
import type * as rentPaymentsPolicy from "../rentPaymentsPolicy.js";
import type * as resendApi from "../resendApi.js";
import type * as residentMatch from "../residentMatch.js";
import type * as residentTriage from "../residentTriage.js";
import type * as residents from "../residents.js";
import type * as rosBuild from "../rosBuild.js";
import type * as rosCalc from "../rosCalc.js";
import type * as rosFormat from "../rosFormat.js";
import type * as rosPolicy from "../rosPolicy.js";
import type * as rosValidators from "../rosValidators.js";
import type * as rosView from "../rosView.js";
import type * as rosterFields from "../rosterFields.js";
import type * as rosterImport from "../rosterImport.js";
import type * as rosterMapping from "../rosterMapping.js";
import type * as sanitize from "../sanitize.js";
import type * as sarahConfig from "../sarahConfig.js";
import type * as sarahConfigLib from "../sarahConfigLib.js";
import type * as sarahConfigRead from "../sarahConfigRead.js";
import type * as sarahKb from "../sarahKb.js";
import type * as sarahReplies from "../sarahReplies.js";
import type * as sarahTools from "../sarahTools.js";
import type * as screening from "../screening.js";
import type * as screeningPrompt from "../screeningPrompt.js";
import type * as severity from "../severity.js";
import type * as singleTenantMigration from "../singleTenantMigration.js";
import type * as smsBot from "../smsBot.js";
import type * as tasks from "../tasks.js";
import type * as team from "../team.js";
import type * as technicians from "../technicians.js";
import type * as tenantViews from "../tenantViews.js";
import type * as tenants from "../tenants.js";
import type * as threads from "../threads.js";
import type * as tourPrompt from "../tourPrompt.js";
import type * as tourSchedule from "../tourSchedule.js";
import type * as tours from "../tours.js";
import type * as transcriptEmail from "../transcriptEmail.js";
import type * as twilioApi from "../twilioApi.js";
import type * as unitFieldsPolicy from "../unitFieldsPolicy.js";
import type * as unitMatch from "../unitMatch.js";
import type * as unitRent from "../unitRent.js";
import type * as unitRentLib from "../unitRentLib.js";
import type * as unitRentPolicy from "../unitRentPolicy.js";
import type * as units from "../units.js";
import type * as users from "../users.js";
import type * as waBot from "../waBot.js";
import type * as waPrompt from "../waPrompt.js";
import type * as wahaApi from "../wahaApi.js";
import type * as whatsapp from "../whatsapp.js";
import type * as workOrderBilling from "../workOrderBilling.js";
import type * as workOrderStatus from "../workOrderStatus.js";
import type * as workOrderWindow from "../workOrderWindow.js";
import type * as workOrders from "../workOrders.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  amScope: typeof amScope;
  appUrl: typeof appUrl;
  assetManagers: typeof assetManagers;
  audit: typeof audit;
  auditEntities: typeof auditEntities;
  authz: typeof authz;
  board: typeof board;
  calendarView: typeof calendarView;
  clerkWebhook: typeof clerkWebhook;
  conversations: typeof conversations;
  coreQuestions: typeof coreQuestions;
  counters: typeof counters;
  crons: typeof crons;
  dashboard: typeof dashboard;
  demoSeed: typeof demoSeed;
  docs: typeof docs;
  docsImport: typeof docsImport;
  elevenLabsApi: typeof elevenLabsApi;
  exceptionOrder: typeof exceptionOrder;
  feeMigration: typeof feeMigration;
  feeSettings: typeof feeSettings;
  feeSettingsLib: typeof feeSettingsLib;
  financeAccess: typeof financeAccess;
  geminiApi: typeof geminiApi;
  googleApi: typeof googleApi;
  googleCalendar: typeof googleCalendar;
  http: typeof http;
  jobRoles: typeof jobRoles;
  leadScoring: typeof leadScoring;
  leads: typeof leads;
  ledger: typeof ledger;
  ledgerAccountSeed: typeof ledgerAccountSeed;
  ledgerAccounts: typeof ledgerAccounts;
  maintenance: typeof maintenance;
  maintenanceReasons: typeof maintenanceReasons;
  notifications: typeof notifications;
  notify: typeof notify;
  orgMigration: typeof orgMigration;
  orgSettings: typeof orgSettings;
  otlp: typeof otlp;
  ownerIdentity: typeof ownerIdentity;
  ownerLinking: typeof ownerLinking;
  ownerRouting: typeof ownerRouting;
  ownerRoutingLib: typeof ownerRoutingLib;
  ownerStatements: typeof ownerStatements;
  ownerTransfer: typeof ownerTransfer;
  ownerVerifyLib: typeof ownerVerifyLib;
  owners: typeof owners;
  ownersImport: typeof ownersImport;
  ownersImportLib: typeof ownersImportLib;
  phone: typeof phone;
  photoEmails: typeof photoEmails;
  places: typeof places;
  placesApi: typeof placesApi;
  probeFixtures: typeof probeFixtures;
  promptMigration: typeof promptMigration;
  properties: typeof properties;
  publicLinks: typeof publicLinks;
  qualifications: typeof qualifications;
  qualifyRules: typeof qualifyRules;
  questionFlowLib: typeof questionFlowLib;
  ratings: typeof ratings;
  rentPayments: typeof rentPayments;
  rentPaymentsLib: typeof rentPaymentsLib;
  rentPaymentsPolicy: typeof rentPaymentsPolicy;
  resendApi: typeof resendApi;
  residentMatch: typeof residentMatch;
  residentTriage: typeof residentTriage;
  residents: typeof residents;
  rosBuild: typeof rosBuild;
  rosCalc: typeof rosCalc;
  rosFormat: typeof rosFormat;
  rosPolicy: typeof rosPolicy;
  rosValidators: typeof rosValidators;
  rosView: typeof rosView;
  rosterFields: typeof rosterFields;
  rosterImport: typeof rosterImport;
  rosterMapping: typeof rosterMapping;
  sanitize: typeof sanitize;
  sarahConfig: typeof sarahConfig;
  sarahConfigLib: typeof sarahConfigLib;
  sarahConfigRead: typeof sarahConfigRead;
  sarahKb: typeof sarahKb;
  sarahReplies: typeof sarahReplies;
  sarahTools: typeof sarahTools;
  screening: typeof screening;
  screeningPrompt: typeof screeningPrompt;
  severity: typeof severity;
  singleTenantMigration: typeof singleTenantMigration;
  smsBot: typeof smsBot;
  tasks: typeof tasks;
  team: typeof team;
  technicians: typeof technicians;
  tenantViews: typeof tenantViews;
  tenants: typeof tenants;
  threads: typeof threads;
  tourPrompt: typeof tourPrompt;
  tourSchedule: typeof tourSchedule;
  tours: typeof tours;
  transcriptEmail: typeof transcriptEmail;
  twilioApi: typeof twilioApi;
  unitFieldsPolicy: typeof unitFieldsPolicy;
  unitMatch: typeof unitMatch;
  unitRent: typeof unitRent;
  unitRentLib: typeof unitRentLib;
  unitRentPolicy: typeof unitRentPolicy;
  units: typeof units;
  users: typeof users;
  waBot: typeof waBot;
  waPrompt: typeof waPrompt;
  wahaApi: typeof wahaApi;
  whatsapp: typeof whatsapp;
  workOrderBilling: typeof workOrderBilling;
  workOrderStatus: typeof workOrderStatus;
  workOrderWindow: typeof workOrderWindow;
  workOrders: typeof workOrders;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
