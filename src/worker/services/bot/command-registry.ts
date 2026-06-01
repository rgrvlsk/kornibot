export type PrivateBotCommandName = "aniversari" | "felicitacions";

export type BotCommandAccessLevel = "audit_member" | "staff" | "superadmin";

export type PrivateBotCommandAccess = {
  auditMember: boolean;
  staff: boolean;
  superadmin: boolean;
};

export type TelegramBotCommandPayload = {
  command: string;
  description: string;
};

type PrivateBotCommandDefinition = TelegramBotCommandPayload & {
  name: PrivateBotCommandName;
  accessLevel: BotCommandAccessLevel;
  menuText: string;
};

const MENU_COMMAND: TelegramBotCommandPayload = {
  command: "menu",
  description: "Mostra les comandes disponibles",
};

const COMMANDS_BY_ACCESS_LEVEL: Record<BotCommandAccessLevel, PrivateBotCommandDefinition[]> = {
  audit_member: [
    {
      name: "aniversari",
      command: "aniversari",
      description: "Guarda el teu aniversari",
      accessLevel: "audit_member",
      menuText: "Guarda el teu aniversari.",
    },
  ],
  staff: [
    {
      name: "felicitacions",
      command: "felicitacions",
      description: "Puja imatges de felicitacio",
      accessLevel: "staff",
      menuText: "Puja imatges de felicitacio.",
    },
  ],
  superadmin: [],
};

function hasAccessToLevel(access: PrivateBotCommandAccess, level: BotCommandAccessLevel): boolean {
  if (level === "audit_member") {
    return access.auditMember;
  }

  if (level === "staff") {
    return access.staff || access.superadmin;
  }

  return access.superadmin;
}

export function privateBotCommandsForAccess(access: PrivateBotCommandAccess): TelegramBotCommandPayload[] {
  const commands = Object.values(COMMANDS_BY_ACCESS_LEVEL)
    .flat()
    .filter((command) => hasAccessToLevel(access, command.accessLevel));

  return commands.length > 0
    ? [MENU_COMMAND, ...commands.map(({ command, description }) => ({ command, description }))]
    : [];
}

export function formatPrivateBotCommandMenu(access: PrivateBotCommandAccess): string {
  const lines = ["Comandes disponibles:"];

  for (const command of Object.values(COMMANDS_BY_ACCESS_LEVEL).flat()) {
    if (hasAccessToLevel(access, command.accessLevel)) {
      lines.push(`/${command.command} - ${command.menuText}`);
    }
  }

  return lines.join("\n");
}
