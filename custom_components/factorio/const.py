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
]
CATEGORIES = ["players", "planets", "defense", "evolution", "research"]
EVENT_WINDOW_MINUTES = 60
MAX_RECENT_EVENTS = 50
PROTOCOL_VERSION = 1
