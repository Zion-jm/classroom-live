"use client";
import { useEffect, useState } from "react";
export default function LobbyQR({ code }: { code: string }) {
  const [image, setImage] = useState(""),
    [url, setUrl] = useState(""),
    [large, setLarge] = useState(false);
  useEffect(() => {
    let active = true;
    const link = new URL("/", location.origin);
    link.searchParams.set("room", code);
    setUrl(link.href);
    void import("qrcode")
      .then((q) =>
        q.toDataURL(link.href, {
          width: large ? 600 : 200,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#193e36", light: "#ffffff" },
        }),
      )
      .then((data) => {
        if (active) setImage(data);
      })
      .catch(() => {
        if (active) setImage("");
      });
    return () => {
      active = false;
    };
  }, [code, large]);
  return (
    <div className={`lobby-qr ${large ? "qr-large" : ""}`}>
      {image && (
        <img
          src={image}
          alt={`Scan to join room ${code}`}
          width={large ? 400 : 180}
          height={large ? 400 : 180}
        />
      )}
      <div>
        <strong>Scan to join</strong>
        <p className="small">
          <a href={url}>{url}</a>
        </p>
        {/localhost|127\.0\.0\.1/.test(url) && (
          <p className="small">
            This local address works only on this computer. Use your deployed
            URL for student phones.
          </p>
        )}
        <button className="text-button" onClick={() => setLarge(!large)}>
          {large ? "Smaller QR" : "Projector view"}
        </button>
      </div>
    </div>
  );
}
