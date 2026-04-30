import React, { useEffect, useMemo, useState } from "react";
function getRiskLevel(score) {
  if (score >= 70) return { label: "High", color: "red" };
  if (score >= 55) return { label: "Moderate", color: "orange" };
  return { label: "Low", color: "green" };
}
import InsightCard from "./InsightCard";
import { checkGuardrails, EAP_RESOURCE_LINK } from "./guardrails";

import "./App.css";

const anthropicSystemPrompt = `You are a workplace wellbeing assistant for tech workers.
Your role is to help users understand their work patterns
and build healthier habits.

You MUST follow these rules at all times:
- Never diagnose any mental health condition
- Never use clinical language like "anxiety", "depression",
  or "burnout diagnosis"
- Always frame insights as observations about patterns,
  not conclusions about the person
- If a user expresses distress, immediately respond with
  empathy and direct them to professional support,
  then stop engaging on that topic
- Use supportive, non-judgmental language at all times
- Always position suggestions as options, never as prescriptions

Your insight cards should follow this format:
- Observation: what the data shows (neutral, factual)
- Context: how it compares to healthy benchmarks
- Suggestion: one small actionable habit to try
- Reminder: you are not a substitute for professional support

When burnout risk score exceeds 70/100, always append:
"If you're feeling overwhelmed, please consider speaking
with your manager, a trusted colleague, or a mental health
professional. Your company's EAP is a great place to start."`;

const benchmarkReference = {
  burnoutHealthyRange:
    "A steadier week usually stays below 55/100 burnout risk with at least one visible recovery block after high-load days.",
  onCallHealthyRange:
    "A healthier on-call week usually keeps overnight incidents at 0-2 and avoids repeated alerts after 2:00 AM.",
  boundaryHealthyRange:
    "Boundary health is typically stronger above 75/100 when after-hours work stays under 25%.",
};

const defaultSupportReminder =
  "This dashboard is not a substitute for professional support. If patterns feel hard to manage, consider reaching out to your manager, EAP, or a licensed professional.";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const weeklyData = [
  {
    id: "mar10",
    label: "Mar 10 - Mar 16",
    sourceState: "5 sources connected",
    burnout: {
      score: 64,
      delta: 6,
      series: [48, 52, 55, 60, 63, 66, 64],
      insights: [
        { label: "Meeting spillover", value: "9.5h", note: "Context switching peaked on Tuesday and Wednesday." },
        { label: "Focus debt", value: "41%", note: "Protected time dropped below your baseline." },
      ],
    },
    onCall: {
      incidents: 4,
      averageTime: "2:03 AM",
      bars: [0, 1, 0, 2, 1, 0, 0],
      log: [
        { time: "11:54 PM", detail: "Auth timeout wave", severity: "Medium" },
        { time: "2:07 AM", detail: "Primary region alert", severity: "High" },
        { time: "2:33 AM", detail: "Secondary verification page", severity: "Medium" },
        { time: "3:11 AM", detail: "Customer escalation follow-up", severity: "Low" },
      ],
    },
    boundary: {
      score: 72,
      delta: -2,
      series: [76, 78, 74, 71, 73, 70, 72],
      afterHours: 38,
      note: "Slack activity moved later into the evening on three consecutive days.",
    },
  },
  {
    id: "mar17",
    label: "Mar 17 - Mar 23",
    sourceState: "6 sources connected",
    burnout: {
      score: 78,
      delta: 14,
      series: [57, 61, 66, 72, 74, 79, 78],
      insights: [
        { label: "Sustained overload", value: "4 days", note: "Stress markers stayed elevated past your normal reset window." },
        { label: "Recovery debt", value: "52%", note: "Break adherence dropped while task switching climbed." },
      ],
    },
    onCall: {
      incidents: 6,
      averageTime: "2:26 AM",
      bars: [1, 1, 0, 2, 1, 1, 0],
      log: [
        { time: "12:09 AM", detail: "API latency page", severity: "High" },
        { time: "1:13 AM", detail: "Rollback coordination", severity: "High" },
        { time: "2:24 AM", detail: "Metrics threshold breach", severity: "Medium" },
        { time: "2:41 AM", detail: "Repeat alert suppression", severity: "Medium" },
        { time: "3:06 AM", detail: "Support handoff", severity: "Low" },
      ],
    },
    boundary: {
      score: 61,
      delta: -11,
      series: [72, 70, 68, 66, 64, 62, 61],
      afterHours: 46,
      note: "Weekend catch-up work resurfaced and personal blocks were frequently overridden.",
    },
  },
];

function formatDelta(value, suffix = "pts vs last week") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value} ${suffix}`;
}

function fallbackInsightsForWeek(week) {
  const elevated = week.burnout.score > 70;
  return [
    {
      title: "Burnout signal",
      observation: `Burnout risk is ${week.burnout.score}/100 and stayed elevated across ${week.burnout.series.filter((value) => value >= 70).length || 1} day(s).`,
      benchmarkComparison: benchmarkReference.burnoutHealthyRange,
      suggestion: "Try protecting one no-meeting recovery block after the heaviest day this week.",
      professionalSupportReminder: elevated
        ? "If you're feeling overwhelmed, please consider speaking with your manager, a trusted colleague, or a mental health professional. Your company's EAP is a great place to start."
        : defaultSupportReminder,
    },
    {
      title: "On-call load",
      observation: `${week.onCall.incidents} incident(s) landed this week, with the average alert arriving around ${week.onCall.averageTime}.`,
      benchmarkComparison: benchmarkReference.onCallHealthyRange,
      suggestion: "If possible, shift one follow-up task out of the day after an overnight alert.",
      professionalSupportReminder: defaultSupportReminder,
    },
    {
      title: "Boundary pattern",
      observation: `Boundary health is ${week.boundary.score}/100 and after-hours activity reached ${week.boundary.afterHours}% of tracked work.`,
      benchmarkComparison: benchmarkReference.boundaryHealthyRange,
      suggestion: "Consider setting a visible stop time on one or two evenings to help restore a clearer endpoint.",
      professionalSupportReminder: defaultSupportReminder,
    },
  ];
}

function extractTextFromAnthropicResponse(payload) {
  if (!payload || !Array.isArray(payload.content)) return "";
  return payload.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseInsightCards(text, week) {
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return fallbackInsightsForWeek(week);
    return parsed.slice(0, 3).map((item, index) => ({
      title: item.title || `Insight ${index + 1}`,
      observation: item.observation || "No observation returned.",
      benchmarkComparison: item.benchmarkComparison || item.context || "No benchmark comparison returned.",
      suggestion: item.suggestion || "No suggestion returned.",
      professionalSupportReminder: item.professionalSupportReminder || item.reminder || defaultSupportReminder,
    }));
  } catch {
    return fallbackInsightsForWeek(week);
  }
}

function buildAnthropicUserPrompt(week) {
  return [
    "Generate exactly 3 wellbeing insight cards as a JSON array.",
    "Each object must have these string fields: title, observation, benchmarkComparison, suggestion, professionalSupportReminder.",
    "Keep each field concise and supportive.",
    "Use only the data below and do not diagnose anything.",
    "",
    `Week: ${week.label}`,
    `Burnout risk score: ${week.burnout.score}/100`,
    `Burnout week-over-week delta: ${week.burnout.delta}`,
    `Burnout trend: ${week.burnout.series.join(", ")}`,
    `On-call incidents: ${week.onCall.incidents}`,
    `Average on-call alert time: ${week.onCall.averageTime}`,
    `On-call daily counts: ${week.onCall.bars.join(", ")}`,
    `Boundary health score: ${week.boundary.score}/100`,
    `Boundary week-over-week delta: ${week.boundary.delta}`,
    `Boundary trend: ${week.boundary.series.join(", ")}`,
    `After-hours activity: ${week.boundary.afterHours}%`,
    `Boundary note: ${week.boundary.note}`,
    `Benchmark reference for burnout: ${benchmarkReference.burnoutHealthyRange}`,
    `Benchmark reference for on-call load: ${benchmarkReference.onCallHealthyRange}`,
    `Benchmark reference for boundaries: ${benchmarkReference.boundaryHealthyRange}`,
  ].join("\n");
}

function SimplePanel({ title, tone, stat, detail, items }) {
  return (
    <section className={`panel-card ${tone}`}>
     <span className={`panel-kicker ${tone}`}>
  {title}
  <span className={`risk-badge ${tone}`} style={{ marginLeft: 8 }}>
    {tone.toUpperCase()}
  </span>
</span>
      <div className="score-value" style={{ marginTop: 12 }}>{stat}</div>
      <p className="panel-subtitle">{detail}</p>
      <div className="panel-footer">
        {items.map((item) => (
          <div className="footer-stat" key={item.label}>
            <div>
              <strong>{item.label}</strong>
              <p className="footer-note">{item.note}</p>
            </div>
            <span className={`timeline-badge ${tone}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [selectedWeek, setSelectedWeek] = useState(weeklyData[0].id);
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem("anthropic_api_key") || "");
  const [cards, setCards] = useState(() => fallbackInsightsForWeek(weeklyData[0]));
  const [status, setStatus] = useState("Add an Anthropic API key to generate live insight cards, or use the fallback examples shown here.");
  const [isLoading, setIsLoading] = useState(false);

  </header(
    () => weeklyData.find((entry) => entry.id === selectedWeek) ?? weeklyData[0],
    [selectedWeek]
  );
  
const burnoutRisk = getRiskLevel(week.burnout.score);

const showAlert = week.burnout.score >= 70;
  
  useEffect(() => {
    setCards(fallbackInsightsForWeek(week));
  }, [week]);

  useEffect(() => {
    window.localStorage.setItem("anthropic_api_key", apiKey);
  }, [apiKey]);

  async function generateInsights() {
    if (!apiKey.trim()) {
      setStatus("Enter an Anthropic API key to request live cards. The current cards are local fallbacks.");
      return;
    }

    setIsLoading(true);
    setStatus(`Generating insight cards for ${week.label}...`);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 900,
          system: anthropicSystemPrompt,
          messages: [
            {
              role: "user",
              content: buildAnthropicUserPrompt(week),
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await response.json();
      const rawText = extractTextFromAnthropicResponse(payload);
      const guardrailResult = checkGuardrails("", rawText);

      if (guardrailResult.blocked) {
        setCards([
          {
            title: "Support reminder",
            observation: guardrailResult.safeMessage,
            benchmarkComparison: "The original model output was withheld by the guardrail check.",
            suggestion: "Pause the AI workflow and route the user toward human support.",
            professionalSupportReminder: guardrailResult.eapLink || EAP_RESOURCE_LINK,
          },
        ]);
        setStatus("Guardrails intercepted the model output and replaced it with a support response.");
      } else {
        setCards(parseInsightCards(rawText, week));
        setStatus(`Live Claude insights loaded for ${week.label}.`);
      }
    } catch (error) {
      setCards(fallbackInsightsForWeek(week));
      setStatus(`Live generation failed, so fallback cards are shown instead. ${String(error.message || "").slice(0, 180)}`.trim());
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div className="header-copy">
          <span className="eyebrow">Weekly Wellbeing Dashboard</span>
          <h1>Energy, load, and boundaries in one view.</h1>
          <p>Track burnout risk, on-call fatigue, and recovery patterns across the week without losing the bigger picture.</p>
        </div>
        <div className="header-actions">
          <div className="control">
            <label htmlFor="week-selector">Week</label>
            <select id="week-selector" value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)}>
              {weeklyData.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button className="connect-button" type="button">Connect Data Source</button>
        </div>
      </header>

      {showAlert && (
  <div className="alert-banner">
    ⚠️ Burnout risk is high this week ({week.burnout.score}/100).
    Consider reviewing workload and recovery time.
  </div>
)}
      
      <section className="panels-grid">
        
       <SimplePanel
  title={`Burnout Risk Tracker (${burnoutRisk.label})`}
  tone={burnoutRisk.color}
  stat={`${week.burnout.score}/100`}
  detail={formatDelta(week.burnout.delta)}
  items={week.burnout.insights}
/>
        <SimplePanel
          title="On-Call Fatigue Log"
          tone="orange"
          stat={String(week.onCall.incidents)}
          detail={`Avg page ${week.onCall.averageTime}`}
          items={week.onCall.log.slice(0, 3).map((entry) => ({
            label: entry.detail,
            note: entry.time,
            value: entry.severity,
          }))}
        />
        <SimplePanel
          title="Boundary Health Score"
          tone="green"
          stat={`${week.boundary.score}/100`}
          detail={formatDelta(week.boundary.delta)}
          items={[
            { label: "After-hours activity", note: "Tracked work outside preferred hours.", value: `${week.boundary.afterHours}%` },
            { label: "Boundary note", note: week.boundary.note, value: dayLabels[0] },
          ]}
        />
      </section>

      <section className="ai-section">
        <div className="ai-section-header">
          <div>
            <span className="eyebrow">AI Insight Cards</span>
            <h2 style={{ marginTop: 14, fontSize: "1.55rem" }}>Claude-generated weekly coaching cards</h2>
            <p className="resource-copy" style={{ marginTop: 8, maxWidth: "64ch" }}>
              Each card includes an observation, benchmark comparison, suggestion, and professional support reminder.
            </p>
          </div>
          <div className="ai-controls">
            <input
              className="api-key-input"
              type="password"
              placeholder="Anthropic API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button className="secondary-button" type="button" onClick={() => setApiKey("")}>Clear Key</button>
            <button className="connect-button" type="button" onClick={generateInsights} disabled={isLoading}>
              {isLoading ? "Generating..." : "Generate Cards"}
            </button>
          </div>
        </div>

        <div className="ai-status">{status}</div>
        <div className="ai-card-grid">
          {cards.map((card) => (
            <InsightCard key={card.title} card={card} />
          ))}
        </div>
      </section>
    </main>
  );
}
