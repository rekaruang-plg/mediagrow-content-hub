"use client";

import { CalendarClock, Camera, Copy, PanelsTopLeft } from "lucide-react";

export type ChannelOverride = { caption: string; scheduledFor: string };
export type ChannelOverrides = Record<string, ChannelOverride>;
export type StoredChannelSetting = { channel: string; caption?: string | null; scheduled_for?: string | null };

const labels: Record<string, string> = {
  ig_feed: "Instagram Feed",
  ig_story: "Instagram Story",
  ig_reel: "Instagram Reel",
  fb_feed: "Facebook Feed",
  fb_story: "Facebook Story",
  fb_reel: "Facebook Reel",
};

export const channelLabel = (channel: string) => labels[channel] || channel;
const emptyOverride = (): ChannelOverride => ({ caption: "", scheduledFor: "" });
const toWibInput = (value?: string | null) => {
  if (!value || Date.parse(value) <= Date.now()) return "";
  return new Date(Date.parse(value) + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
};

export function storedSettingsToOverrides(settings?: StoredChannelSetting[] | null): ChannelOverrides {
  return Object.fromEntries((settings || []).map(setting => [setting.channel, {
    caption: setting.caption || "",
    scheduledFor: toWibInput(setting.scheduled_for),
  }]));
}

export function serializeChannelOverrides(channels: string[], overrides: ChannelOverrides) {
  return channels.map(channel => {
    const override = overrides[channel] || emptyOverride();
    let scheduledFor: string | null = null;
    if (override.scheduledFor) {
      const date = new Date(`${override.scheduledFor}:00+07:00`);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error(`${channelLabel(channel)} harus dijadwalkan di waktu yang akan datang.`);
      scheduledFor = date.toISOString();
    }
    return { channel, caption: override.caption.trim() || null, scheduled_for: scheduledFor };
  });
}

export function ChannelCustomizer({ channels, masterCaption, masterTime, overrides, onChange, disabled = false }: {
  channels: string[];
  masterCaption: string;
  masterTime?: string;
  overrides: ChannelOverrides;
  onChange: (value: ChannelOverrides) => void;
  disabled?: boolean;
}) {
  const update = (channel: string, field: keyof ChannelOverride, value: string) => onChange({
    ...overrides,
    [channel]: { ...(overrides[channel] || emptyOverride()), [field]: value },
  });

  return <section className="channel-customizer">
    <div className="channel-customizer-heading"><div><b>Penyesuaian per channel</b><small>Kosongkan kolom untuk memakai caption dan waktu utama.</small></div><span>{channels.length} channel</span></div>
    <div className="channel-customizer-grid">{channels.map(channel => {
      const value = overrides[channel] || emptyOverride();
      const PlatformIcon = channel.startsWith("ig_") ? Camera : PanelsTopLeft;
      return <article key={channel}>
        <header><span className={channel.startsWith("ig_") ? "instagram" : "facebook"}><PlatformIcon size={15}/></span><div><b>{channelLabel(channel)}</b><small>{value.caption || value.scheduledFor ? "Dibuat khusus" : "Mengikuti pengaturan utama"}</small></div></header>
        <label>Caption khusus<textarea rows={4} disabled={disabled} value={value.caption} onChange={event => update(channel, "caption", event.target.value)} placeholder="Kosong = gunakan caption utama"/></label>
        <button type="button" className="secondary compact" disabled={disabled || !masterCaption.trim()} onClick={() => update(channel, "caption", masterCaption)}><Copy size={13}/>Salin caption utama</button>
        <label>Waktu khusus · WIB<input type="datetime-local" disabled={disabled} value={value.scheduledFor} onChange={event => update(channel, "scheduledFor", event.target.value)}/></label>
        {value.scheduledFor ? <button type="button" className="secondary compact" disabled={disabled} onClick={() => update(channel, "scheduledFor", "")}><CalendarClock size={13}/>Gunakan waktu utama</button> : masterTime ? <small className="channel-fallback-time">Utama: {masterTime}</small> : null}
      </article>;
    })}</div>
  </section>;
}
