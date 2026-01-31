import { Customer, enums, resources, toMicros, errors as googleAdsErrors } from "google-ads-api";
import { CampaignPlan, CampaignPlanAdGroup, CampaignPlanKeyword } from "@/types/sem";

type PublishResult = {
  campaignsCreated: number;
  adGroupsCreated: number;
  adsCreated: number;
  keywordsCreated: number;
  negativeKeywordsCreated: number;
  warnings: string[];
  errors: string[];
};

const MAX_RSA_HEADLINES = 15;
const MAX_RSA_DESCRIPTIONS = 4;

const CAMPAIGN_STATUS = enums.CampaignStatus.PAUSED;
const AD_GROUP_STATUS = enums.AdGroupStatus.ENABLED;
const AD_STATUS = enums.AdGroupAdStatus.ENABLED;
const KEYWORD_STATUS = enums.AdGroupCriterionStatus.ENABLED;

function ensureFinalUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function escapeGaqlLiteral(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function lookupGeoTargetConstant(customer: Customer, name: string): Promise<string | null> {
  const escaped = escapeGaqlLiteral(name);
  const query =
    "SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.status " +
    `FROM geo_target_constant WHERE geo_target_constant.name = '${escaped}' AND geo_target_constant.status = 'ENABLED'`;
  const rows = await customer.query(query);
  const row = rows?.[0] as { geo_target_constant?: { resource_name?: string } } | undefined;
  return row?.geo_target_constant?.resource_name ?? null;
}

async function lookupLanguageConstant(customer: Customer, name: string): Promise<string | null> {
  const escaped = escapeGaqlLiteral(name);
  const query =
    "SELECT language_constant.resource_name, language_constant.name " +
    `FROM language_constant WHERE language_constant.name = '${escaped}'`;
  const rows = await customer.query(query);
  const row = rows?.[0] as { language_constant?: { resource_name?: string } } | undefined;
  return row?.language_constant?.resource_name ?? null;
}

function mapMatchType(value?: string): enums.KeywordMatchType {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "EXACT") return enums.KeywordMatchType.EXACT;
  if (normalized === "PHRASE") return enums.KeywordMatchType.PHRASE;
  if (normalized === "BROAD") return enums.KeywordMatchType.BROAD;
  return enums.KeywordMatchType.BROAD;
}

function toKeywordCriteria(
  adGroupResourceName: string,
  keyword: CampaignPlanKeyword,
  negative: boolean,
): resources.IAdGroupCriterion {
  return {
    ad_group: adGroupResourceName,
    status: KEYWORD_STATUS,
    negative,
    keyword: {
      text: keyword.Keyword,
      match_type: mapMatchType(keyword.MatchType),
    },
  };
}

function toNegativeCampaignCriterion(
  campaignResourceName: string,
  keyword: CampaignPlanKeyword,
): resources.ICampaignCriterion {
  return {
    campaign: campaignResourceName,
    negative: true,
    keyword: {
      text: keyword.Keyword,
      match_type: mapMatchType(keyword.MatchType),
    },
  };
}

function buildResponsiveSearchAd(finalUrl: string, adGroup: CampaignPlanAdGroup): resources.IAdGroupAd {
  const ads = Array.isArray(adGroup.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds : [];
  const rsa = ads[0];
  const headlines = (rsa?.Headlines ?? []).slice(0, MAX_RSA_HEADLINES);
  const descriptions = (rsa?.Descriptions ?? []).slice(0, MAX_RSA_DESCRIPTIONS);
  return {
    ad_group: "",
    status: AD_STATUS,
    ad: {
      responsive_search_ad: {
        headlines: headlines.map((text) => ({ text })),
        descriptions: descriptions.map((text) => ({ text })),
      },
      final_urls: [finalUrl],
    },
  };
}

async function createCampaignCriteria(
  customer: Customer,
  campaignResourceName: string,
  campaign: CampaignPlan,
  warnings: string[],
) {
  const criteria: resources.ICampaignCriterion[] = [];

  const locationNames = campaign.Location?.Included?.map((item) => item.Name).filter(Boolean) ?? [];
  for (const name of locationNames) {
    const resourceName = await lookupGeoTargetConstant(customer, name);
    if (!resourceName) {
      warnings.push(`Location "${name}" was not found in geo target constants.`);
      continue;
    }
    criteria.push({
      campaign: campaignResourceName,
      location: { geo_target_constant: resourceName },
    });
  }

  const locationWithRadius = campaign.Location?.Included?.filter((item) => item.RadiusKm);
  if (locationWithRadius?.length) {
    warnings.push("Location radius targeting is not supported yet; radius values were ignored.");
  }
  if (campaign.Location?.Excluded?.length) {
    warnings.push("Excluded locations are not published yet.");
  }

  const languages = Array.isArray(campaign.Language) ? campaign.Language : [];
  for (const language of languages) {
    const resourceName = await lookupLanguageConstant(customer, language);
    if (!resourceName) {
      warnings.push(`Language "${language}" was not found in language constants.`);
      continue;
    }
    criteria.push({
      campaign: campaignResourceName,
      language: { language_constant: resourceName },
    });
  }

  const campaignNegatives = Array.isArray(campaign.NegativeKeywords) ? campaign.NegativeKeywords : [];
  for (const keyword of campaignNegatives) {
    if (!keyword?.Keyword) continue;
    criteria.push(toNegativeCampaignCriterion(campaignResourceName, keyword));
  }

  if (!criteria.length) return;
  const response = await customer.campaignCriteria.create(criteria, { partial_failure: true });
  if (response.partial_failure_error?.message) {
    warnings.push(response.partial_failure_error.message);
  }
}

function deriveCampaignType(campaign: CampaignPlan): enums.AdvertisingChannelType {
  const raw = campaign.CampaignType?.toLowerCase() ?? "";
  if (raw.includes("performance")) {
    throw new Error(`Campaign "${campaign.CampaignName}" uses Performance Max, which is not supported yet.`);
  }
  if (raw.includes("display")) {
    return enums.AdvertisingChannelType.DISPLAY;
  }
  return enums.AdvertisingChannelType.SEARCH;
}

function buildCampaignResource(
  campaign: CampaignPlan,
  budgetResourceName: string,
): resources.ICampaign {
  const base: resources.ICampaign = {
    name: campaign.CampaignName,
    status: CAMPAIGN_STATUS,
    advertising_channel_type: deriveCampaignType(campaign),
    campaign_budget: budgetResourceName,
  };

  if (campaign.TargetCPAMYR && campaign.TargetCPAMYR > 0) {
    base.target_cpa = { target_cpa_micros: toMicros(campaign.TargetCPAMYR) };
  } else {
    base.manual_cpc = {};
  }

  return base;
}

function truncateName(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function buildBudgetResource(campaign: CampaignPlan, warnings: string[]): resources.ICampaignBudget {
  const budget = campaign.BudgetDailyMYR ?? 0;
  const name = `${campaign.CampaignName} Budget`;
  const trimmedName = truncateName(name, 255);
  if (trimmedName.length !== name.length) {
    warnings.push(`Budget name for "${campaign.CampaignName}" exceeded 255 chars and was truncated.`);
  }
  return {
    name: trimmedName,
    amount_micros: toMicros(Math.max(0, budget)),
    delivery_method: enums.BudgetDeliveryMethod.STANDARD,
  };
}

function buildAdGroupResource(campaignResourceName: string, adGroup: CampaignPlanAdGroup): resources.IAdGroup {
  const resource: resources.IAdGroup = {
    campaign: campaignResourceName,
    name: adGroup.AdGroupName,
    status: AD_GROUP_STATUS,
    type: enums.AdGroupType.SEARCH_STANDARD,
  };
  if (adGroup.DefaultMaxCPCMYR && adGroup.DefaultMaxCPCMYR > 0) {
    resource.cpc_bid_micros = toMicros(adGroup.DefaultMaxCPCMYR);
  }
  return resource;
}

function formatGoogleAdsErrorEntry(entry: {
  message?: string | null;
  error_code?: Record<string, string | number | null>;
  location?: { field_path_elements?: Array<{ field_name?: string | null }> };
  trigger?: string | null;
}): string {
  const codeKey = entry.error_code ? Object.keys(entry.error_code)[0] : undefined;
  const codeValue = codeKey ? entry.error_code?.[codeKey] : undefined;
  const fieldPath = entry.location?.field_path_elements?.map((item) => item.field_name).filter(Boolean).join(".");
  const trigger = typeof entry.trigger === "string" ? entry.trigger : undefined;
  const segments = [entry.message ?? "Google Ads error"];
  if (codeKey) segments.push(`code=${codeKey}${codeValue !== undefined ? `:${codeValue}` : ""}`);
  if (fieldPath) segments.push(`field=${fieldPath}`);
  if (trigger) segments.push(`trigger=${trigger}`);
  return segments.join(" | ");
}

function formatGoogleAdsError(error: unknown): string[] {
  if (error instanceof googleAdsErrors.GoogleAdsFailure) {
    return (error.errors ?? []).map((entry) =>
      formatGoogleAdsErrorEntry(entry as Parameters<typeof formatGoogleAdsErrorEntry>[0]),
    );
  }
  const maybeErrors = (error as { errors?: Array<unknown> } | null)?.errors;
  if (Array.isArray(maybeErrors) && maybeErrors.length > 0) {
    return maybeErrors.map((entry) => formatGoogleAdsErrorEntry(entry as Parameters<typeof formatGoogleAdsErrorEntry>[0]));
  }
  if (error instanceof Error) {
    return [error.message];
  }
  return ["Unknown error"];
}

function formatPartialFailureError(partialFailure: unknown): string | null {
  if (!partialFailure) return null;
  const formatted = formatGoogleAdsError(partialFailure);
  if (formatted.length && formatted[0] !== "Unknown error") {
    return formatted.join(" || ");
  }
  const message = (partialFailure as { message?: string } | null)?.message;
  if (message) return message;
  try {
    return JSON.stringify(partialFailure);
  } catch {
    return "Unknown partial failure error";
  }
}

export async function publishCampaignPlan(params: {
  customer: Customer;
  campaigns: CampaignPlan[];
  finalUrl: string;
}): Promise<PublishResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let campaignsCreated = 0;
  let adGroupsCreated = 0;
  let adsCreated = 0;
  let keywordsCreated = 0;
  let negativeKeywordsCreated = 0;

  const finalUrl = ensureFinalUrl(params.finalUrl);
  if (!finalUrl) {
    throw new Error("Final URL is required to publish ads.");
  }

  for (const campaign of params.campaigns) {
    try {
      const budgetResponse = await params.customer.campaignBudgets.create([buildBudgetResource(campaign, warnings)], {
        partial_failure: true,
      });
      const budgetFailure = formatPartialFailureError(budgetResponse.partial_failure_error);
      const budgetResourceName = budgetResponse.results?.[0]?.resource_name;
      if (!budgetResourceName) {
        throw new Error(
          `Failed to create budget for ${campaign.CampaignName}.${budgetFailure ? ` ${budgetFailure}` : ""}`,
        );
      }

      const campaignResponse = await params.customer.campaigns.create(
        [buildCampaignResource(campaign, budgetResourceName)],
        { partial_failure: true },
      );
      const campaignFailure = formatPartialFailureError(campaignResponse.partial_failure_error);
      const campaignResourceName = campaignResponse.results?.[0]?.resource_name;
      if (!campaignResourceName) {
        throw new Error(
          `Failed to create campaign ${campaign.CampaignName}.${campaignFailure ? ` ${campaignFailure}` : ""}`,
        );
      }
      campaignsCreated += 1;

      await createCampaignCriteria(params.customer, campaignResourceName, campaign, warnings);

      const adGroups = Array.isArray(campaign.AdGroups) ? campaign.AdGroups : [];
      for (const adGroup of adGroups) {
        const adGroupResponse = await params.customer.adGroups.create([buildAdGroupResource(campaignResourceName, adGroup)], {
          partial_failure: true,
        });
        const adGroupFailure = formatPartialFailureError(adGroupResponse.partial_failure_error);
        const adGroupResourceName = adGroupResponse.results?.[0]?.resource_name;
        if (!adGroupResourceName) {
          warnings.push(
            `Failed to create ad group ${adGroup.AdGroupName} under ${campaign.CampaignName}.${
              adGroupFailure ? ` ${adGroupFailure}` : ""
            }`,
          );
          continue;
        }
        adGroupsCreated += 1;

        const availableAds = Array.isArray(adGroup.ResponsiveSearchAds) ? adGroup.ResponsiveSearchAds : [];
        if (availableAds.length > 1) {
          warnings.push(`Ad group "${adGroup.AdGroupName}" has multiple RSAs; only the first was published.`);
        }
        const adGroupAd = buildResponsiveSearchAd(finalUrl, adGroup);
        adGroupAd.ad_group = adGroupResourceName;
        const rsa = adGroupAd.ad?.responsive_search_ad;
        const hasHeadlines = (rsa?.headlines ?? []).length > 0;
        const hasDescriptions = (rsa?.descriptions ?? []).length > 0;
        if (!hasHeadlines || !hasDescriptions) {
          warnings.push(`Ad group "${adGroup.AdGroupName}" is missing RSA headlines/descriptions; ad was skipped.`);
        } else {
          const adResponse = await params.customer.adGroupAds.create([adGroupAd], { partial_failure: true });
          if (adResponse.partial_failure_error?.message) {
            warnings.push(adResponse.partial_failure_error.message);
          } else {
            adsCreated += 1;
          }
        }

        const targeting = adGroup.Targeting;
        const keywords = targeting?.Keywords ?? [];
        const negatives = targeting?.NegativeKeywords ?? [];
        const criteriaPayload: resources.IAdGroupCriterion[] = [];
        for (const keyword of keywords) {
          if (!keyword?.Keyword) continue;
          criteriaPayload.push(toKeywordCriteria(adGroupResourceName, keyword, false));
        }
        for (const keyword of negatives) {
          if (!keyword?.Keyword) continue;
          const criterion = toKeywordCriteria(adGroupResourceName, keyword, true);
          criteriaPayload.push(criterion);
        }
        if (criteriaPayload.length) {
          const criterionResponse = await params.customer.adGroupCriteria.create(criteriaPayload, {
            partial_failure: true,
          });
          if (criterionResponse.partial_failure_error?.message) {
            warnings.push(criterionResponse.partial_failure_error.message);
          }
          keywordsCreated += keywords.length;
          negativeKeywordsCreated += negatives.length;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to publish campaign.";
      const details = formatGoogleAdsError(err);
      errors.push(`${campaign.CampaignName}: ${message}${details.length ? ` Details: ${details.join(" || ")}` : ""}`);
    }
  }

  return {
    campaignsCreated,
    adGroupsCreated,
    adsCreated,
    keywordsCreated,
    negativeKeywordsCreated,
    warnings,
    errors,
  };
}
