from __future__ import annotations

import argparse
import csv
import io
import json
import statistics
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


SO_RELEVANT_COLUMNS = [
    "Employment",
    "RemoteWork",
    "WorkExp",
    "TimeSearching",
    "TimeAnswering",
    "Frustration",
    "ProfessionalTech",
    "JobSat",
    "Frequency_1",
    "Frequency_2",
    "Frequency_3",
]

BRFSS_FIELD_SPECS = {
    "_STATE": (1, 2),
    "PHYSHLTH": (102, 2),
    "MENTHLTH": (104, 2),
    "EMPLOY1": (201, 1),
    "LSATISFY": (349, 1),
    "EMTSUPRT": (350, 1),
    "SDLONELY": (351, 1),
    "SDHEMPLY": (352, 1),
    "_AGE80": (1980, 2),
    "_SEX": (1976, 1),
    "_LLCPWT2": (1691, 10),
}

TIME_BUCKET_TO_MINUTES = {
    "Less than 15 minutes a day": 7.5,
    "15-30 minutes a day": 22.5,
    "30-60 minutes a day": 45.0,
    "60-120 minutes a day": 90.0,
    "Over 120 minutes a day": 150.0,
}

JOB_SAT_TO_SCORE = {str(i): i for i in range(11)}

FREQUENCY_TO_SCORE = {
    "Never": 0,
    "1-2 times a week": 1,
    "3-5 times a week": 2,
    "6-10 times a week": 3,
    "10+ times a week": 4,
}

BRFSS_LSATISFY = {
    1: "Very satisfied",
    2: "Satisfied",
    3: "Dissatisfied",
    4: "Very dissatisfied",
}


@dataclass
class NumericSummary:
    average: float | None
    median: float | None
    sample_size: int

    def as_dict(self) -> dict[str, float | int | None]:
        return {
            "average": None if self.average is None else round(self.average, 2),
            "median": None if self.median is None else round(self.median, 2),
            "sample_size": self.sample_size,
        }


def summarize_numeric(values: list[float]) -> NumericSummary:
    return NumericSummary(
        average=statistics.fmean(values) if values else None,
        median=statistics.median(values) if values else None,
        sample_size=len(values),
    )


def parse_fixed_width(line: str, spec: tuple[int, int]) -> str:
    start, width = spec
    start -= 1
    return line[start:start + width].strip()


def safe_int(raw: str) -> int | None:
    raw = raw.strip()
    if not raw or raw in {"7", "8", "9", "77", "88", "99"}:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def top_counts(counter: Counter[str], limit: int = 5) -> list[dict[str, int]]:
    return [{"label": label, "count": count} for label, count in counter.most_common(limit)]


def load_so_rows(path: Path) -> Iterable[dict[str, str]]:
    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                yield {column: row.get(column, "") for column in SO_RELEVANT_COLUMNS}
        return

    with zipfile.ZipFile(path) as zf:
        csv_name = next(name for name in zf.namelist() if name.lower().endswith("survey_results_public.csv"))
        with zf.open(csv_name) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8")
            reader = csv.DictReader(text)
            for row in reader:
                yield {column: row.get(column, "") for column in SO_RELEVANT_COLUMNS}


def load_brfss_rows(path: Path) -> Iterable[dict[str, str]]:
    if path.suffix.lower() == ".asc":
        with path.open(encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                yield {name: parse_fixed_width(line, spec) for name, spec in BRFSS_FIELD_SPECS.items()}
        return

    if path.suffix.lower() == ".csv":
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                yield {name: row.get(name, "") for name in BRFSS_FIELD_SPECS}
        return

    with zipfile.ZipFile(path) as zf:
        asc_name = next(name for name in zf.namelist() if name.strip().lower().endswith(".asc"))
        with zf.open(asc_name) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8", errors="ignore")
            for line in text:
                yield {name: parse_fixed_width(line, spec) for name, spec in BRFSS_FIELD_SPECS.items()}


def compute_so_benchmarks(rows: Iterable[dict[str, str]]) -> dict[str, object]:
    searching_minutes = []
    answering_minutes = []
    job_satisfaction_scores = []
    collaboration_friction_scores = []
    work_experience_years = []
    frustration_counter = Counter()

    burnout_risk_index_values = []

    for row in rows:
        search_minutes = TIME_BUCKET_TO_MINUTES.get(row["TimeSearching"])
        answer_minutes = TIME_BUCKET_TO_MINUTES.get(row["TimeAnswering"])
        job_sat_score = JOB_SAT_TO_SCORE.get(row["JobSat"])
        friction_values = [
            FREQUENCY_TO_SCORE[row[key]]
            for key in ("Frequency_1", "Frequency_2", "Frequency_3")
            if row.get(key) in FREQUENCY_TO_SCORE
        ]
        friction_score = statistics.fmean(friction_values) if friction_values else None

        if search_minutes is not None:
            searching_minutes.append(search_minutes)
        if answer_minutes is not None:
            answering_minutes.append(answer_minutes)
        if job_sat_score is not None:
            job_satisfaction_scores.append(job_sat_score)
        if friction_score is not None:
            collaboration_friction_scores.append(friction_score)
        if row["WorkExp"].isdigit():
            work_experience_years.append(float(row["WorkExp"]))
        if row["Frustration"] and row["Frustration"] != "NA":
            for value in [part.strip() for part in row["Frustration"].split(";")]:
                if value:
                    frustration_counter[value] += 1

        if search_minutes is not None and friction_score is not None and job_sat_score is not None:
            search_component = min(search_minutes / 150.0, 1.0) * 35.0
            friction_component = (friction_score / 4.0) * 35.0
            satisfaction_component = ((10 - job_sat_score) / 10.0) * 30.0
            burnout_risk_index_values.append(search_component + friction_component + satisfaction_component)

    return {
        "relevant_columns": SO_RELEVANT_COLUMNS,
        "burnout_proxy_benchmarks": {
            "job_satisfaction_score": summarize_numeric([float(x) for x in job_satisfaction_scores]).as_dict(),
            "daily_time_searching_minutes": summarize_numeric(searching_minutes).as_dict(),
            "daily_time_answering_minutes": summarize_numeric(answering_minutes).as_dict(),
            "collaboration_friction_score": summarize_numeric(collaboration_friction_scores).as_dict(),
            "derived_burnout_risk_index": summarize_numeric(burnout_risk_index_values).as_dict(),
            "work_experience_years": summarize_numeric(work_experience_years).as_dict(),
        },
        "distribution_snapshots": {
            "top_frustrations": top_counts(frustration_counter),
        },
    }


def compute_brfss_benchmarks(rows: Iterable[dict[str, str]]) -> dict[str, object]:
    mental_health_days = []
    physical_health_days = []
    emotional_support_scores = []
    loneliness_scores = []
    life_satisfaction_counter = Counter()

    for row in rows:
        mental = safe_int(row["MENTHLTH"])
        physical = safe_int(row["PHYSHLTH"])
        support = safe_int(row["EMTSUPRT"])
        lonely = safe_int(row["SDLONELY"])
        life = safe_int(row["LSATISFY"])

        if mental is not None and mental <= 30:
            mental_health_days.append(mental)
        if physical is not None and physical <= 30:
            physical_health_days.append(physical)
        if support is not None and 1 <= support <= 5:
            emotional_support_scores.append(6 - support)
        if lonely is not None and 1 <= lonely <= 5:
            loneliness_scores.append(6 - lonely)
        if life is not None and life in BRFSS_LSATISFY:
            life_satisfaction_counter[BRFSS_LSATISFY[life]] += 1

    return {
        "relevant_columns": list(BRFSS_FIELD_SPECS.keys()),
        "sleep_benchmark_note": "The BRFSS source available here does not expose a clear direct sleep-hours field, so this output includes recovery-related proxies instead.",
        "wellbeing_benchmarks": {
            "days_mental_health_not_good": summarize_numeric([float(x) for x in mental_health_days]).as_dict(),
            "days_physical_health_not_good": summarize_numeric([float(x) for x in physical_health_days]).as_dict(),
            "emotional_support_score": summarize_numeric([float(x) for x in emotional_support_scores]).as_dict(),
            "loneliness_score": summarize_numeric([float(x) for x in loneliness_scores]).as_dict(),
        },
        "distribution_snapshots": {
            "life_satisfaction": top_counts(life_satisfaction_counter),
        },
    }


def build_dashboard_payload(so: dict[str, object], brfss: dict[str, object]) -> dict[str, object]:
    so_burnout = so["burnout_proxy_benchmarks"]
    brfss_wellbeing = brfss["wellbeing_benchmarks"]
    return {
        "burnoutRiskBenchmarks": {
            "jobSatisfactionAverage": so_burnout["job_satisfaction_score"]["average"],
            "searchTimeMinutesAverage": so_burnout["daily_time_searching_minutes"]["average"],
            "answerTimeMinutesAverage": so_burnout["daily_time_answering_minutes"]["average"],
            "collaborationFrictionAverage": so_burnout["collaboration_friction_score"]["average"],
            "burnoutRiskIndexAverage": so_burnout["derived_burnout_risk_index"]["average"],
        },
        "sleepAndRecoveryBenchmarks": {
            "brfssMentalHealthDaysAverage": brfss_wellbeing["days_mental_health_not_good"]["average"],
            "brfssPhysicalHealthDaysAverage": brfss_wellbeing["days_physical_health_not_good"]["average"],
            "brfssEmotionalSupportAverage": brfss_wellbeing["emotional_support_score"]["average"],
            "brfssLonelinessAverage": brfss_wellbeing["loneliness_score"]["average"],
            "note": brfss["sleep_benchmark_note"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build dashboard benchmark JSON from Stack Overflow and BRFSS survey sources.")
    parser.add_argument("--so-archive", default="stack-overflow-developer-survey-2024.zip")
    parser.add_argument("--brfss-archive", default="LLCP2024ASC.zip")
    parser.add_argument("--output", default="dashboard_benchmarks.json")
    args = parser.parse_args()

    so_summary = compute_so_benchmarks(load_so_rows(Path(args.so_archive)))
    brfss_summary = compute_brfss_benchmarks(load_brfss_rows(Path(args.brfss_archive)))

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "stackOverflow": so_summary,
        "brfss": brfss_summary,
        "dashboard": build_dashboard_payload(so_summary, brfss_summary),
    }

    Path(args.output).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
