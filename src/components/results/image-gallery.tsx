"use client";

import { useEffect, useMemo, useState } from "react";

type ResultsImageGalleryProps = {
  imageUrls: string[];
};

export function ResultsImageGallery({ imageUrls }: ResultsImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const normalizedImages = useMemo(
    () => imageUrls.map((imageUrl, index) => ({ key: `${index}-${imageUrl}`, imageUrl })),
    [imageUrls],
  );
  const flatIndexByKey = useMemo(
    () => new Map(normalizedImages.map((item, index) => [item.key, index])),
    [normalizedImages],
  );

  const activeImage = activeIndex !== null ? normalizedImages[activeIndex] : null;

  useEffect(() => {
    if (activeImage === null) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveIndex(null);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeImage]);

  if (normalizedImages.length === 0) {
    return <p className="text-sm text-stone-500">表示できる画像はありません。</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {normalizedImages.map((item) => {
          const flatIndex = flatIndexByKey.get(item.key);
          return (
            <button
              type="button"
              key={item.key}
              onClick={() => {
                if (typeof flatIndex === "number") {
                  setActiveIndex(flatIndex);
                }
              }}
              className="aspect-[4/3] overflow-hidden rounded-2xl border border-stone-200 bg-stone-50"
            >
              <img
                src={item.imageUrl}
                alt="application"
                loading="lazy"
                className="h-full w-full object-cover transition hover:scale-[1.02]"
              />
            </button>
          );
        })}
      </div>

      {activeImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setActiveIndex(null)}
          role="presentation"
        >
          <div className="w-full max-w-6xl" onClick={(event) => event.stopPropagation()} role="presentation">
            <div className="mb-2 flex items-center justify-end text-xs text-white/90">
              <button
                type="button"
                onClick={() => setActiveIndex(null)}
                className="rounded-full border border-white/40 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-white/10"
              >
                閉じる
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl bg-black">
              <img
                src={activeImage.imageUrl}
                alt="application expanded"
                className="max-h-[85vh] w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
