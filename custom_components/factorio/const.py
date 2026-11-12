"""Constants for the Factorio integration."""

DOMAIN = "factorio"
TOPIC_PREFIX = "factorio"

CONF_PROVIDER = "provider"
CONF_SERVER_ID = "server_id"
PROVIDER_MQTT = "mqtt"
PROVIDERS = [PROVIDER_MQTT]

GAME_STATES = ["running", "paused", "stopped", "no_connection"]
EVENT_TYPES = [
    "player_joined",
    "player_left",
    "attack_started",
    "attack_ended",
    "turrets_no_ammo",
    "turrets_ok",
    "research_finished",
    "player_died",
    "line_problem",
    "line_recovered",
    "drills_depleted",
]
CATEGORIES = ["players", "planets", "defense", "evolution", "research", "machines", "drills"]
CONF_LINE_SHARE = "line_problem_share"  # percent of a group that stands
CONF_LINE_MINUTES = "line_problem_minutes"  # game minutes
DEFAULT_LINE_SHARE = 30
DEFAULT_LINE_MINUTES = 2
EVENT_WINDOW_MINUTES = 60
MAX_RECENT_EVENTS = 50
PROTOCOL_VERSION = 1
