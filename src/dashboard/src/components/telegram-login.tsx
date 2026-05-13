import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    onKornibotTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export function TelegramLogin(props: {
  botUsername: string;
  onAuth: (user: Record<string, unknown>) => void | Promise<void>;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !props.botUsername) {
      return undefined;
    }

    const container = containerRef.current;
    container.innerHTML = "";
    window.onKornibotTelegramAuth = (user) => {
      void props.onAuth(user);
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", props.botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onKornibotTelegramAuth(user)");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete window.onKornibotTelegramAuth;
    };
  }, [props.botUsername, props.onAuth]);

  if (!props.botUsername) {
    return (
      <div className="widget-placeholder">
        <strong>Falta el bot username</strong>
        <p>Configura `VITE_TELEGRAM_BOT_USERNAME` per activar el login real amb Telegram.</p>
      </div>
    );
  }

  return <div className="telegram-login-widget" ref={containerRef} />;
}
