"""Line and drill trackers (pure logic, game-time clock)."""

from custom_components.factorio.lines import DrillTracker, LineTracker

HOLD = 7200


def group(recipe="iron-plate", total=100, no_input=40, output_full=0, no_power=0) -> dict:
    return {"recipe": recipe, "total": total, "working": total - no_input - output_full - no_power,
            "no_input": no_input, "output_full": output_full, "no_power": no_power, "at": [[1, 2]]}


def planet(*groups) -> dict:
    return {"nauvis": {"total": 100, "working": 60, "groups": list(groups)}}


def test_problem_after_hold_in_game_ticks():
    tracker = LineTracker()
    data = planet(group())
    assert tracker.update(data, 1000, 0.3, HOLD, from_clock=True) == []
    assert tracker.update(data, 8199, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis") == []
    events = tracker.update(data, 8200, 0.3, HOLD, from_clock=True)
    assert events == [("line_problem", {"planet": "nauvis", "recipe": "iron-plate", "reason": "no_input",
                                        "stopped": 40, "total": 100})]
    problem = tracker.problems("nauvis")[0]
    assert problem["minutes"] == 2
    assert (problem["recipe"], problem["total"], problem["stopped"], problem["positions"]) == ("iron-plate", 100, 40, [[1, 2]])
    assert tracker.problems("gleba") == []


def test_same_tick_repeated_is_a_pause():
    tracker = LineTracker()
    data = planet(group())
    tracker.update(data, 1000, 0.3, HOLD, from_clock=True)
    tracker.update(data, 8200, 0.3, HOLD, from_clock=True)
    for _ in range(3):
        assert tracker.update(data, 8200, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis")[0]["minutes"] == 2


def test_group_below_share_is_not_a_problem():
    tracker = LineTracker()
    data = planet(group(no_input=20))
    tracker.update(data, 1000, 0.3, HOLD, from_clock=True)
    assert tracker.update(data, 50000, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis") == []


def test_recovery_needs_the_hold_too():
    tracker = LineTracker()
    tracker.update(planet(group()), 1000, 0.3, HOLD, from_clock=True)
    tracker.update(planet(group()), 8200, 0.3, HOLD, from_clock=True)
    gone = planet()
    assert tracker.update(gone, 9000, 0.3, HOLD, from_clock=True) == []
    assert tracker.update(gone, 16199, 0.3, HOLD, from_clock=True) == []
    assert tracker.update(gone, 16200, 0.3, HOLD, from_clock=True) == [("line_recovered", {"planet": "nauvis", "recipe": "iron-plate"})]
    assert tracker.problems("nauvis") == []


def test_problem_returning_before_recovery_cancels_it():
    tracker = LineTracker()
    tracker.update(planet(group()), 1000, 0.3, HOLD, from_clock=True)
    tracker.update(planet(group()), 8200, 0.3, HOLD, from_clock=True)
    tracker.update(planet(), 9000, 0.3, HOLD, from_clock=True)
    tracker.update(planet(group()), 12000, 0.3, HOLD, from_clock=True)
    assert tracker.update(planet(group()), 30000, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis")


def test_blip_shorter_than_hold_gives_no_events():
    tracker = LineTracker()
    tracker.update(planet(group()), 1000, 0.3, HOLD, from_clock=True)
    tracker.update(planet(), 5000, 0.3, HOLD, from_clock=True)
    assert tracker.update(planet(group()), 6000, 0.3, HOLD, from_clock=True) == []
    assert tracker.update(planet(group()), 13100, 0.3, HOLD, from_clock=True) == []  # re-anchored at 6000
    assert [e[0] for e in tracker.update(planet(group()), 13200, 0.3, HOLD, from_clock=True)] == ["line_problem"]


def test_reason_is_the_largest_bucket():
    tracker = LineTracker()
    data = planet(group(no_input=5, output_full=10, no_power=30))
    tracker.update(data, 0, 0.3, HOLD, from_clock=True)
    (_, payload), = tracker.update(data, HOLD, 0.3, HOLD, from_clock=True)
    assert payload["reason"] == "no_power"
    assert payload["stopped"] == 45
    tracker = LineTracker()
    data = planet(group(recipe="gear", no_input=10, output_full=30, no_power=5))
    tracker.update(data, 0, 0.3, HOLD, from_clock=True)
    (_, payload), = tracker.update(data, HOLD, 0.3, HOLD, from_clock=True)
    assert payload["reason"] == "output_full"


def test_clock_ticks_alone_advance_the_hold():
    tracker = LineTracker()
    data = planet(group())
    tracker.update(data, 1000, 0.3, HOLD, from_clock=True)
    assert tracker.update(data, 8199, 0.3, HOLD, from_clock=True) == []
    assert [e[0] for e in tracker.update(data, 8200, 0.3, HOLD, from_clock=True)] == ["line_problem"]
    assert tracker.update(data, 8500, 0.3, HOLD, from_clock=True) == []
    assert tracker.update(data, 8500, 0.3, HOLD, from_clock=True) == []


def test_recovery_by_clock_only():
    tracker = LineTracker()
    tracker.update(planet(group()), 1000, 0.3, HOLD, from_clock=True)
    tracker.update(planet(group()), 8200, 0.3, HOLD, from_clock=True)
    gone = planet()
    tracker.update(gone, 9000, 0.3, HOLD, from_clock=True)
    assert tracker.update(gone, 16199, 0.3, HOLD, from_clock=True) == []
    assert [e[0] for e in tracker.update(gone, 16200, 0.3, HOLD, from_clock=True)] == ["line_recovered"]


def test_small_step_back_is_ignored():
    tracker = LineTracker()
    data = planet(group())
    tracker.update(data, 1000, 0.3, HOLD, from_clock=True)
    tracker.update(data, 20000, 0.3, HOLD, from_clock=True)
    minutes = tracker.problems("nauvis")[0]["minutes"]
    assert tracker.update(data, 20000 - 3600, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis")[0]["minutes"] == minutes


def test_big_step_back_resets_anchors_silently():
    tracker = LineTracker()
    data = planet(group())
    tracker.update(data, 1000, 0.3, HOLD, from_clock=True)
    tracker.update(data, 20000, 0.3, HOLD, from_clock=True)
    assert tracker.update(data, 20000 - 3601, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis") == []
    # counting restarts from the older tick
    assert [e[0] for e in tracker.update(data, 16399 + HOLD, 0.3, HOLD, from_clock=True)] == ["line_problem"]


def test_restart_with_old_retained_data_reports_once_on_first_clock_tick():
    tracker = LineTracker()
    data = planet(group())
    assert tracker.update(data, 1000, 0.3, HOLD, from_clock=True) == []
    events = tracker.update(data, 100000, 0.3, HOLD, from_clock=True)
    assert [e[0] for e in events] == ["line_problem"]
    assert tracker.problems("nauvis")[0]["minutes"] == 27
    assert tracker.update(data, 100300, 0.3, HOLD, from_clock=True) == []


def test_category_gone_resets_without_events():
    tracker = LineTracker()
    tracker.update(planet(group()), 1000, 0.3, HOLD, from_clock=True)
    tracker.update(planet(group()), 8200, 0.3, HOLD, from_clock=True)
    tracker.reset()
    assert tracker.problems("nauvis") == []
    assert tracker.update(planet(group()), 9000, 0.3, HOLD, from_clock=True) == []  # a new baseline
    assert tracker.update(planet(group()), 16100, 0.3, HOLD, from_clock=True) == []
    assert [e[0] for e in tracker.update(planet(group()), 16200, 0.3, HOLD, from_clock=True)] == ["line_problem"]


def drills(depleted: int, resource="iron-ore", total=96) -> dict:
    return {"nauvis": {"by_resource": {resource: {"total": total, "working": 10, "depleted": depleted, "stuck": 0}}}}


def test_drills_depleted_rules():
    tracker = DrillTracker()
    assert tracker.update(drills(14), 100) == []  # baseline
    assert tracker.update(drills(16), 1000) == [
        ("drills_depleted", {"planet": "nauvis", "resource": "iron-ore", "depleted": 16, "total": 96})]
    assert tracker.update(drills(17), 2000) == []  # within 18000 ticks of the last event
    events = tracker.update(drills(18), 19000)
    assert [e[1]["depleted"] for e in events] == [18]


def test_drills_decrease_is_not_an_event():
    tracker = DrillTracker()
    tracker.update(drills(14), 0)
    assert tracker.update(drills(10), 100) == []
    assert tracker.update(drills(11), 200)[0][1]["depleted"] == 11


def test_drills_category_gone_is_a_new_baseline():
    tracker = DrillTracker()
    tracker.update(drills(14), 0)
    tracker.reset()
    assert tracker.update(drills(20), 100) == []
    assert tracker.update(drills(21), 200)[0][1]["depleted"] == 21


def test_drills_after_an_older_save_are_not_muted_by_a_future_event():
    tracker = DrillTracker()
    tracker.update(drills(14), 100_000)
    assert tracker.update(drills(16), 101_000)[0][0] == "drills_depleted"
    tracker.update(drills(10), 50_000)  # an older save: fewer depleted, the clock is back
    events = tracker.update(drills(11), 51_000)
    assert [e[1]["depleted"] for e in events] == [11]


def test_unknown_resource_never_raises_event():
    tracker = DrillTracker()
    tracker.update(drills(3, "unknown"), 0)
    assert tracker.update(drills(9, "unknown"), 100000) == []


def data_update(tracker, data, tick):
    return tracker.update(data, tick, 0.3, HOLD, from_clock=False)


def test_redelivered_old_data_does_not_reset_an_active_problem():
    tracker = LineTracker()
    data = planet(group())
    data_update(tracker, data, 1000)
    assert [e[0] for e in tracker.update(data, 8200, 0.3, HOLD, from_clock=True)] == ["line_problem"]
    tracker.update(data, 50000, 0.3, HOLD, from_clock=True)
    before = tracker.problems("nauvis")
    assert data_update(tracker, data, 1000) == []
    assert tracker.problems("nauvis") == before
    assert tracker.update(data, 50300, 0.3, HOLD, from_clock=True) == []


def test_redelivered_old_data_does_not_lose_a_pending_recovery():
    tracker = LineTracker()
    data_update(tracker, planet(group()), 1000)
    tracker.update(planet(group()), 8200, 0.3, HOLD, from_clock=True)
    gone = planet()
    data_update(tracker, gone, 40000)
    tracker.update(gone, 45000, 0.3, HOLD, from_clock=True)
    assert data_update(tracker, gone, 40000) == []
    assert [e[0] for e in tracker.update(gone, 40000 + HOLD, 0.3, HOLD, from_clock=True)] == ["line_recovered"]


def test_clock_far_back_still_resets_but_data_far_back_does_not():
    tracker = LineTracker()
    data = planet(group())
    data_update(tracker, data, 1000)
    tracker.update(data, 20000, 0.3, HOLD, from_clock=True)
    data_update(tracker, data, 5000)
    assert len(tracker.problems("nauvis")) == 1
    assert tracker.update(data, 20000 - 3601, 0.3, HOLD, from_clock=True) == []
    assert tracker.problems("nauvis") == []


def test_data_tick_is_taken_as_is_without_a_clock():
    tracker = LineTracker()
    data = planet(group())
    assert data_update(tracker, data, 1000) == []
    events = tracker.update(data, 100000, 0.3, HOLD, from_clock=True)
    assert [e[0] for e in events] == ["line_problem"]
    assert tracker.problems("nauvis")[0]["minutes"] == 27
    tracker.reset()
    data_update(tracker, data, 90000)
    assert [e[0] for e in data_update(tracker, data, 90000 + HOLD)] == ["line_problem"]
