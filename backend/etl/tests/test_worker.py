"""Despacho puro do worker (payload → plano), sem Redis nem banco."""

from datetime import date

import pytest

from era5.worker import InvalidJob, JobPlan, describe, plan_job

TODAY = date(2026, 10, 5)


def test_latest_uses_lag_window():
    plan = plan_job({"kind": "latest"}, TODAY)
    assert plan == JobPlan("latest", date(2026, 9, 19), date(2026, 9, 29))


def test_range_without_bbox_targets_all_cells():
    plan = plan_job({"kind": "range", "from": "2025-11-01", "to": "2026-03-31"}, TODAY)
    assert plan.kind == "range" and plan.bbox is None and plan.cell is None
    assert (plan.date_from, plan.date_to) == (date(2025, 11, 1), date(2026, 3, 31))


def test_range_with_bbox_in_cds_order():
    plan = plan_job({"kind": "range", "from": "2025-11-01", "to": "2025-11-30", "bbox": [-16.1, -49.4, -16.8, -48.7]}, TODAY)
    assert plan.bbox == (-16.1, -49.4, -16.8, -48.7)
    assert "(-16.1, -49.4, -16.8, -48.7)" in describe(plan)


def test_cell_job():
    plan = plan_job({"kind": "cell", "lat": -16.7, "lon": -49.3, "from": "2025-11-01", "to": "2026-03-29"}, TODAY)
    assert plan.cell == (-16.7, -49.3)


@pytest.mark.parametrize(
    "data",
    [
        {"kind": "weekly"},
        {},
        "não é objeto",
        {"kind": "range", "from": "2026-01-10", "to": "2026-01-01"},
        {"kind": "range", "from": "ontem", "to": "2026-01-01"},
        {"kind": "range", "from": "2026-01-01", "to": "2026-01-31", "bbox": [-16.8, -49.4, -16.1, -48.7]},  # N < S
        {"kind": "cell", "from": "2026-01-01", "to": "2026-01-31"},  # sem lat/lon
    ],
)
def test_invalid_payloads(data):
    with pytest.raises(InvalidJob):
        plan_job(data, TODAY)
