"use client";

import Link from "next/link";
import { useState } from "react";

import { buildGroupPath } from "@/lib/navigation/group-paths";

type RepresentativeDrawerProps = {
  groupId: string;
  groupName?: string | null;
  activePath?: string;
};

type DrawerLink = {
  href: string;
  label: string;
  icon: "home" | "users" | "target" | "chart";
};

export function RepresentativeDrawer({ groupId, groupName, activePath }: RepresentativeDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = typeof groupName === "string" && groupName.trim() ? groupName.trim() : "サークル";
  const links: DrawerLink[] = [
    { href: buildGroupPath("/", groupId), label: "トップ", icon: "home" },
    { href: buildGroupPath("/representative", groupId), label: "代表ページ", icon: "users" },
    { href: buildGroupPath("/hit", groupId), label: "Hit設定", icon: "target" },
    { href: buildGroupPath("/results", groupId), label: "抽選結果", icon: "chart" },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="代表者メニューを開く"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-900/10 bg-white text-stone-800 shadow-sm transition hover:border-stone-900/30 hover:text-stone-950"
      >
        <MenuIcon />
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="代表者メニューを閉じる"
            className="absolute inset-0 bg-stone-950/30"
            onClick={() => setIsOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-[min(22rem,calc(100vw-2rem))] flex-col bg-white px-5 py-5 text-stone-900 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-stone-200 pb-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Representative</p>
                <p className="mt-1 truncate text-base font-semibold">{displayName}</p>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
              >
                <CloseIcon />
              </button>
            </div>

            <nav className="space-y-2">
              {links.map((item) => {
                const isActive = activePath === item.href.split("?")[0];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={[
                      "flex items-center gap-3 rounded-lg border px-3 py-3 text-sm font-semibold transition",
                      isActive
                        ? "border-sky-200 bg-sky-50 text-sky-900"
                        : "border-transparent text-stone-700 hover:border-stone-200 hover:bg-stone-50 hover:text-stone-950",
                    ].join(" ")}
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-stone-700 shadow-sm">
                      <DrawerItemIcon icon={item.icon} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function DrawerItemIcon({ icon }: { icon: DrawerLink["icon"] }) {
  if (icon === "home") {
    return (
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </svg>
    );
  }

  if (icon === "users") {
    return (
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  if (icon === "target") {
    return (
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 15v-4" />
      <path d="M12 15V8" />
      <path d="M16 15v-6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
