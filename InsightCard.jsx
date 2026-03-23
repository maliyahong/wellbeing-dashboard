import React from "react";

export default function InsightCard({ card }) {
  return (
    <article className="ai-card">
      <div>
        <span className="insight-tag">Claude Card</span>
        <h3 style={{ marginTop: 12 }}>{card.title}</h3>
      </div>

      <div className="ai-card-block">
        <strong>Observation</strong>
        <p className="resource-copy">{card.observation}</p>
      </div>

      <div className="ai-card-block">
        <strong>Benchmark comparison</strong>
        <p className="resource-copy">{card.benchmarkComparison}</p>
      </div>

      <div className="ai-card-block">
        <strong>Suggestion</strong>
        <p className="resource-copy">{card.suggestion}</p>
      </div>

      <div className="ai-card-block">
        <strong>Professional support reminder</strong>
        <p className="resource-copy">{card.professionalSupportReminder}</p>
      </div>
    </article>
  );
}
