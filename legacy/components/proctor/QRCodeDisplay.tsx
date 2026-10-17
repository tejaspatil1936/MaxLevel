"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QRCodeDisplayProps {
  value: string;
  size?: number;
  className?: string;
}

export function QRCodeDisplay({ value, size = 180, className = "" }: QRCodeDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: {
        dark: "#0F172A",
        light: "#FFFFFF",
      },
    })
      .then((url) => setDataUrl(url))
      .catch((err) => console.error("QR Code error:", err));
  }, [value, size]);

  const copyUrl = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div
        className="p-3 bg-white rounded-xl border border-line shadow-xs flex items-center justify-center shrink-0"
        style={{ width: size + 24, height: size + 24 }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Scan QR Code"
            width={size}
            height={size}
            className="rounded"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-ink-muted">
            Generating QR...
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={copyUrl}
        className="text-xs text-pen hover:underline flex items-center gap-1 cursor-pointer font-medium"
      >
        {copied ? "✓ Copied pairing link" : "Copy pairing link"}
      </button>
    </div>
  );
}
