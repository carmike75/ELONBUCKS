import fs from "node:fs";
import path from "node:path";

const knowledgePath = path.join(__dirname, "..", "knowledge", "jsystem-knowledge.json");

export const knowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf-8"));

/**
 * Flattens the knowledge JSON into a single text block (EN + JA side by side)
 * so it can be embedded verbatim in the system prompt as the agent's only
 * source of truth.
 */
export function renderKnowledgeBase(): string {
  const k = knowledge;
  const lines: string[] = [];

  lines.push("=== PRODUCT ===");
  lines.push(`EN: ${k.product.name_en} — ${k.product.full_name_en}, by ${k.product.vendor_en}.`);
  lines.push(`JA: ${k.product.name_ja} — ${k.product.full_name_ja}、${k.product.vendor_ja}。`);
  lines.push(`EN tagline: ${k.product.tagline_en}`);
  lines.push(`JA tagline: ${k.product.tagline_ja}`);

  lines.push("\n=== CERTIFICATIONS & CREDIBILITY ===");
  for (const key of ["mlit_catalog", "netis", "patents", "award", "equivalence"]) {
    lines.push(`EN: ${k.certifications[`${key}_en`]}`);
    lines.push(`JA: ${k.certifications[`${key}_ja`]}`);
  }

  lines.push("\n=== CORE CAPABILITY ===");
  for (const key of [
    "detection",
    "survey_distance",
    "survey_angle",
    "temperature_threshold",
    "damage_visualization",
    "record_keeping",
    "no_traffic_control",
  ]) {
    lines.push(`EN: ${k.core_capability[`${key}_en`]}`);
    lines.push(`JA: ${k.core_capability[`${key}_ja`]}`);
  }

  lines.push("\n=== DAMAGE LEVEL CLASSIFICATION (3-tier color code) ===");
  for (const d of k.damage_levels) {
    lines.push(`EN: ${d.level_en} — ${d.meaning_en}`);
    lines.push(`JA: ${d.level_ja} — ${d.meaning_ja}`);
  }

  lines.push("\n=== SURVEY PROCESS (4 steps) ===");
  for (const s of k.survey_process) {
    lines.push(`EN: ${s.step_en}: ${s.detail_en}`);
    lines.push(`JA: ${s.step_ja}：${s.detail_ja}`);
  }

  lines.push("\n=== DELIVERABLES / REPORT ===");
  lines.push(`EN: ${k.deliverables.deployment_diagram_en}`);
  lines.push(`JA: ${k.deliverables.deployment_diagram_ja}`);
  lines.push(`EN: ${k.deliverables.report_fields_en}`);
  lines.push(`JA: ${k.deliverables.report_fields_ja}`);

  lines.push("\n=== ADOPTION HISTORY / TRACK RECORD ===");
  for (const h of k.adoption_history) {
    lines.push(`EN: ${h.year_en} — ${h.event_en}`);
    lines.push(`JA: ${h.year_ja} — ${h.event_ja}`);
  }

  lines.push("\n=== COST & TIME COMPARISON (reference bridge) ===");
  lines.push(`EN: ${k.cost_comparison.example_bridge_en}`);
  lines.push(`JA: ${k.cost_comparison.example_bridge_ja}`);
  for (const m of k.cost_comparison.methods) {
    lines.push(
      `- ${m.method_en} / ${m.method_ja}: traffic regulation ${m.traffic_regulation_en} (${m.traffic_regulation_ja}), ${m.days} days, ${m.cost_per_sqm_en} (${m.cost_per_sqm_ja}), total ¥${m.total_cost_jpy.toLocaleString()}. ${m.description_en}`
    );
  }
  lines.push(`EN: ${k.cost_comparison.throughput_note_en}`);
  lines.push(`JA: ${k.cost_comparison.throughput_note_ja}`);
  lines.push(`EN: ${k.cost_comparison.conclusion_en}`);
  lines.push(`JA: ${k.cost_comparison.conclusion_ja}`);

  lines.push("\n=== CONTACT ===");
  lines.push(`${k.contact.company_en} (${k.contact.company_ja})`);
  lines.push(`${k.contact.address_en} (${k.contact.address_ja})`);
  lines.push(`TEL: ${k.contact.tel}`);
  lines.push(`Web: ${k.contact.website}`);
  lines.push(`Email: ${k.contact.email}`);

  return lines.join("\n");
}
