"""Async client for the Receipt Printer add-on API."""

from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import ClientError, ClientSession


class ReceiptPrinterApiError(Exception):
    """Raised when the Receipt Printer API cannot complete a request."""


class ReceiptPrinterApi:
    """Small async client for the local add-on API."""

    def __init__(
        self,
        session: ClientSession,
        base_url: str,
        verify_ssl: bool = True,
    ) -> None:
        self._session = session
        self.base_url = base_url.strip().rstrip("/")
        self._verify_ssl = verify_ssl

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        timeout: float = 20,
    ) -> dict[str, Any]:
        try:
            async with asyncio.timeout(timeout):
                response = await self._session.request(
                    method,
                    f"{self.base_url}{path}",
                    json=json,
                    ssl=self._verify_ssl,
                )
                async with response:
                    payload = await response.json(content_type=None)
                    if response.status >= 400:
                        message = payload.get("error") if isinstance(payload, dict) else None
                        raise ReceiptPrinterApiError(
                            message or f"Receipt Printer API returned HTTP {response.status}"
                        )
        except (TimeoutError, ClientError, ValueError) as err:
            raise ReceiptPrinterApiError(str(err)) from err

        if not isinstance(payload, dict):
            raise ReceiptPrinterApiError("Receipt Printer API returned an invalid response")
        if payload.get("ok") is False:
            raise ReceiptPrinterApiError(str(payload.get("error") or "Request failed"))
        return payload

    async def async_health(self) -> dict[str, Any]:
        """Return API health metadata."""
        return await self._request("GET", "/health")

    async def async_printers(self) -> list[dict[str, Any]]:
        """Return configured printers."""
        payload = await self._request("GET", "/api/printers")
        printers = payload.get("printers")
        return printers if isinstance(printers, list) else []

    async def async_jobs(self) -> list[dict[str, Any]]:
        """Return configured print jobs."""
        payload = await self._request("GET", "/api/jobs")
        jobs = payload.get("jobs")
        return jobs if isinstance(jobs, list) else []

    async def async_run_job(
        self,
        job_type: str,
        printer_id: str,
        profile_id: str = "",
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Run a configured job on a printer."""
        body = dict(data or {})
        body["printerId"] = printer_id
        if profile_id:
            body["profileId"] = profile_id
        path_type = "daily-agenda" if job_type == "daily_agenda" else job_type
        return await self._request(
            "POST",
            f"/print/{path_type}",
            json=body,
            timeout=120,
        )
