"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { DocumentSummary, ProfileStats, RoomInfo } from "@/lib/types";

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await api<{ documents: DocumentSummary[] }>("/api/documents");
      setDocuments(data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { documents, loading, error, refresh, setDocuments };
}

export function useActiveRoom() {
  const [room, setRoom] = useState<{ room: RoomInfo; token: string; isHost: boolean } | null>(null);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ room: RoomInfo | null; token?: string; isHost?: boolean }>("/api/rooms");
      setRoom(
        data.room && data.token
          ? { room: data.room, token: data.token, isHost: Boolean(data.isHost) }
          : null
      );
    } catch {
      setRoom(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { room, checked, refresh };
}

export function useProfile() {
  const [profile, setProfile] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ profile: ProfileStats }>("/api/profile");
      setProfile(data.profile);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, loading, refresh };
}

/** Upload with real progress events (XHR under the hood). */
export function uploadDocument(
  file: File,
  onProgress: (percent: number) => void
): Promise<DocumentSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data.document as DocumentSummary);
        } else {
          reject(new Error(data?.error ?? `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error("Upload failed."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
