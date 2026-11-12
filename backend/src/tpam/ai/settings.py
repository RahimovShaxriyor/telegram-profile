"""Persistence of AI settings in the per-mode settings table."""

from __future__ import annotations

from pydantic import ValidationError

from tpam.models import AiSettings
from tpam.storage.repositories import SettingsRepository

AI_SETTINGS_KEY = "ai_settings"


async def load_ai_settings(settings: SettingsRepository) -> AiSettings:
    raw = await settings.get(AI_SETTINGS_KEY)
    if not raw:
        return AiSettings()
    try:
        return AiSettings.model_validate(raw)
    except ValidationError:
        return AiSettings()


async def save_ai_settings(settings: SettingsRepository, value: AiSettings) -> None:
    await settings.set(AI_SETTINGS_KEY, value.model_dump())
