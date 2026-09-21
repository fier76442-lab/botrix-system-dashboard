require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  AuditLogEvent
} = require('discord.js');

const app = express();

/* ==================================================
   CONFIG
================================================== */

const PORT = Number(process.env.PORT || 3000);

const BASE_URL = (
  process.env.BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, '');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ||
  `${BASE_URL}/auth/discord/callback`;

const ADMIN_USER_ID =
  process.env.ADMIN_USER_ID || '';

const ANNOUNCEMENT_CHANNEL_ID =
  process.env.ANNOUNCEMENT_CHANNEL_ID || '';

const SUPPORT_INVITE =
  'https://discord.gg/fVDJrknnE';

const DISCORD_API =
  'https://discord.com/api/v10';

/* ==================================================
   PREMIUM STAFF TEAM CONFIG
================================================== */

const STAFF_GUILD_ID =
  process.env.STAFF_GUILD_ID ||
  '1550513070772584538';

const STAFF_ROLES = [
  {
    id:
      process.env.FOUNDER_ROLE_ID ||
      '1550559361808732210',
    name: 'Founder'
  },
  {
    id:
      process.env.SUPPORT_SUPERVISOR_ROLE_ID ||
      '1550539793459576922',
    name: 'Support Supervisor'
  },
  {
    id:
      process.env.SUPPORT_1_ROLE_ID ||
      '1550539797762678874',
    name: 'Support 1'
  },
  {
    id:
      process.env.SUPPORT_2_ROLE_ID ||
      '1550539801961173013',
    name: 'Support 2'
  },
  {
    id:
      process.env.SUPPORT_3_ROLE_ID ||
      '1550539806889742376',
    name: 'Support 3'
  },
  {
    id:
      process.env.STAFF_TEAM_ROLE_ID ||
      '1550539810190397630',
    name: 'Staff Team'
  }
];

const PARTNER_ROLE_ID =
  process.env.PARTNER_MEMBERS_ROLE_ID ||
  '1550539835369066607';

/* ==================================================
   BOT CLIENT
================================================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ==================================================
   STATS
================================================== */

const stats = {
  messages: 0,
  commands: 0,
  startedAt: Date.now()
};

/* ==================================================
   EXPRESS
================================================== */

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      'CHANGE_THIS_SESSION_SECRET',

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

/* ==================================================
   HELPERS
================================================== */

function isAdministrator(permissionValue) {
  try {
    const permissions = BigInt(
      permissionValue || '0'
    );

    return (
      (permissions &
        BigInt(
          PermissionsBitField.Flags.Administrator
        )) !== 0n
    );
  } catch {
    return false;
  }
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'LOGIN_REQUIRED'
    });
  }

  next();
}

function requireGlobalAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'LOGIN_REQUIRED'
    });
  }

  if (
    !ADMIN_USER_ID ||
    req.session.user.id !== ADMIN_USER_ID
  ) {
    return res.status(403).json({
      error: 'ADMIN_ONLY'
    });
  }

  next();
}

/* ==================================================
   DISCORD API REQUEST
================================================== */

async function discordRequest(
  endpoint,
  accessToken,
  options = {}
) {
  const response = await fetch(
    `${DISCORD_API}${endpoint}`,
    {
      ...options,

      headers: {
        ...(options.headers || {}),

        Authorization:
          `Bearer ${accessToken}`,

        'Content-Type':
          'application/json'
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text
      ? JSON.parse(text)
      : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      `Discord API ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/* ==================================================
   CHECK USER PERMISSION
================================================== */

function userCanManageGuild(guild) {
  if (!guild) return false;

  return isAdministrator(
    guild.permissions
  );
}

/* ==================================================
   GET MANAGEABLE SERVERS
================================================== */

async function getManageableGuilds(req) {
  if (!req.session.discordAccessToken) {
    throw new Error(
      'DISCORD_ACCESS_TOKEN_MISSING'
    );
  }

  const guilds = await discordRequest(
    '/users/@me/guilds',
    req.session.discordAccessToken
  );

  const manageable = [];

  for (const guild of guilds) {
    if (!userCanManageGuild(guild)) {
      continue;
    }

    const botGuild =
      client.guilds.cache.get(guild.id);

    manageable.push({
      id: guild.id,

      name: guild.name,

      icon: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
        : null,

      owner: Boolean(guild.owner),

      permissions:
        guild.permissions,

      administrator: true,

      botPresent:
        Boolean(botGuild),

      botMemberCount:
        botGuild?.memberCount || 0,

      manageable:
        Boolean(botGuild)
    });
  }

  return manageable;
}

/* ==================================================
   GET SELECTED MANAGEABLE GUILD
================================================== */

async function getManageableGuild(
  req,
  guildId
) {
  const guilds =
    await getManageableGuilds(req);

  return (
    guilds.find(
      guild =>
        guild.id === guildId
    ) || null
  );
}

/* ==================================================
   GET BOT GUILD
================================================== */

function getBotGuild(guildId) {
  const guild =
    client.guilds.cache.get(guildId);

  if (!guild) {
    const error = new Error(
      'BOT_NOT_IN_GUILD'
    );

    error.status = 403;

    throw error;
  }

  return guild;
}

/* ==================================================
   PREMIUM STAFF MEMBER MAPPER
================================================== */

function mapStaffMember(member) {
  return {
    id: member.id,

    username:
      member.user.username,

    displayName:
      member.displayName ||
      member.user.globalName ||
      member.user.username,

    globalName:
      member.user.globalName ||
      member.user.username,

    avatar:
      member.displayAvatarURL({
        extension: 'png',
        size: 256
      }),

    bot:
      Boolean(member.user.bot)
  };
}

/* ==================================================
   GET PREMIUM STAFF TEAM
================================================== */

async function getPremiumStaffTeam() {
  const guild =
    getBotGuild(STAFF_GUILD_ID);

  /*
   * Fetch members from Discord so the
   * dashboard gets the latest role data.
   */
  await guild.members.fetch();

  const staff = [];

  for (const role of STAFF_ROLES) {
    const members =
      guild.members.cache.filter(
        member =>
          member.roles.cache.has(
            role.id
          )
      );

    staff.push({
      roleId: role.id,

      roleName:
        role.name,

      members:
        members.map(
          mapStaffMember
        )
    });
  }

  /* ==================================================
     PARTNER MEMBERS
  ================================================== */

  const partnerMembers =
    guild.members.cache.filter(
      member =>
        member.roles.cache.has(
          PARTNER_ROLE_ID
        )
    );

  return {
    guildId:
      guild.id,

    guildName:
      guild.name,

    staff,

    partnerMembers: {
      roleId:
        PARTNER_ROLE_ID,

      roleName:
        'Partner Members',

      members:
        partnerMembers.map(
          mapStaffMember
        )
    },

    updatedAt:
      new Date().toISOString()
  };
}

/* ==================================================
   DASHBOARD DATA
================================================== */

function getDashboardData() {
  const guilds =
    client.guilds.cache.map(
      guild => ({
        id: guild.id,

        name: guild.name,

        icon: guild.icon,

        members:
          guild.memberCount || 0
      })
    );

  return {
    bot: {
      online:
        client.isReady(),

      name:
        client.user?.username ||
        'Botrix System',

      tag:
        client.user?.tag ||
        'Botrix System',

      ping:
        client.ws.ping
    },

    totals: {
      servers:
        guilds.length,

      members:
        guilds.reduce(
          (total, guild) =>
            total + guild.members,
          0
        ),

      messages:
        stats.messages,

      commands:
        stats.commands
    },

    guilds,

    uptime:
      Math.floor(
        (Date.now() -
          stats.startedAt) /
          1000
      ),

    updatedAt:
      new Date().toISOString()
  };
}

/* ==================================================
   ANNOUNCEMENT CHANNEL
================================================== */

async function getAnnouncementChannel(
  channelId =
    ANNOUNCEMENT_CHANNEL_ID
) {
  if (!channelId) {
    throw new Error(
      'ANNOUNCEMENT_CHANNEL_ID_MISSING'
    );
  }

  const channel =
    await client.channels.fetch(
      channelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    throw new Error(
      'ANNOUNCEMENT_CHANNEL_UNAVAILABLE'
    );
  }

  return channel;
}

/* ==================================================
   MESSAGE MAPPER
================================================== */

function mapDiscordMessage(message) {
  return {
    id: message.id,

    author:
      message.author?.username ||
      'Botrix',

    authorId:
      message.author?.id ||
      '',

    avatar:
      message.author?.displayAvatarURL?.({
        size: 128
      }) || '',

    content:
      message.content || '',

    createdAt:
      message.createdAt,

    bot:
      Boolean(
        message.author?.bot
      )
  };
}

/* ==================================================
   GET ANNOUNCEMENTS
================================================== */

async function getAnnouncements(
  channelId =
    ANNOUNCEMENT_CHANNEL_ID
) {
  try {
    const channel =
      await getAnnouncementChannel(
        channelId
      );

    if (
      !channel.messages?.fetch
    ) {
      return [];
    }

    const messages =
      await channel.messages.fetch({
        limit: 30
      });

    return [...messages.values()]
      .filter(
        message =>
          message.content ||
          message.embeds?.length
      )
      .sort(
        (a, b) =>
          b.createdTimestamp -
          a.createdTimestamp
      )
      .map(
        mapDiscordMessage
      );

  } catch (error) {
    console.error(
      'Announcement channel error:',
      error.message
    );

    return [];
  }
}

/* ==================================================
   AUDIT LOG MAPPER
================================================== */

function mapAuditLogEntry(entry) {
  let action = 'Unknown';

  try {
    action =
      AuditLogEvent[entry.action] ||
      String(entry.action);
  } catch {
    action =
      String(entry.action);
  }

  return {
    id:
      entry.id,

    action,

    actionType:
      entry.action,

    executor:
      entry.executor
        ? {
            id:
              entry.executor.id,

            username:
              entry.executor.username,

            globalName:
              entry.executor.globalName ||
              entry.executor.username,

            avatar:
              entry.executor.displayAvatarURL?.({
                size: 64
              }) || ''
          }
        : null,

    targetId:
      entry.targetId || null,

    reason:
      entry.reason || null,

    createdAt:
      entry.createdAt ||
      new Date(
        Number(entry.id) /
          4194304 +
          1420070400000
      )
  };
}

/* ==================================================
   ROOT
================================================== */

app.get('/', (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      'index.html'
    )
  );
});

/* ==================================================
   API DASHBOARD
================================================== */

app.get(
  '/api/dashboard',
  (req, res) => {
    res.json(
      getDashboardData()
    );
  }
);

/* ==================================================
   PREMIUM STAFF API
================================================== */

app.get(
  '/api/premium-staff',
  async (req, res) => {
    try {
      const data =
        await getPremiumStaffTeam();

      res.json(data);

    } catch (error) {
      console.error(
        'Premium Staff error:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          'PREMIUM_STAFF_FAILED'
      });
    }
  }
);

/* ==================================================
   CURRENT USER
================================================== */

app.get(
  '/api/me',
  (req, res) => {
    res.json({
      loggedIn:
        Boolean(
          req.session.user
        ),

      user:
        req.session.user ||
        null,

      isAdmin:
        Boolean(
          req.session.user &&
          ADMIN_USER_ID &&
          req.session.user.id ===
            ADMIN_USER_ID
        )
    });
  }
);

/* ==================================================
   MANAGEABLE SERVERS
================================================== */

app.get(
  '/api/manageable-guilds',
  requireLogin,
  async (req, res) => {
    try {
      const guilds =
        await getManageableGuilds(
          req
        );

      res.json({
        guilds
      });

    } catch (error) {
      console.error(
        'Manageable guilds error:',
        error
      );

      res.status(500).json({
        error:
          'MANAGEABLE_GUILDS_FAILED'
      });
    }
  }
);

/* ==================================================
   SELECT SERVER
================================================== */

app.post(
  '/api/manage/:guildId',
  requireLogin,
  async (req, res) => {
    try {
      const guildId =
        String(
          req.params.guildId
        );

      const guild =
        await getManageableGuild(
          req,
          guildId
        );

      if (!guild) {
        return res.status(403).json({
          error:
            'NO_ADMINISTRATOR_PERMISSION'
        });
      }

      if (!guild.botPresent) {
        return res.status(403).json({
          error:
            'BOT_NOT_IN_GUILD'
        });
      }

      req.session.selectedGuildId =
        guildId;

      res.json({
        ok: true,
        guild
      });

    } catch (error) {
      console.error(
        'Manage guild error:',
        error
      );

      res.status(500).json({
        error:
          'MANAGE_GUILD_FAILED'
      });
    }
  }
);

/* ==================================================
   CURRENT SELECTED SERVER
================================================== */

app.get(
  '/api/selected-guild',
  requireLogin,
  async (req, res) => {
    try {
      const guildId =
        req.session.selectedGuildId;

      if (!guildId) {
        return res.json({
          selected: null
        });
      }

      const guild =
        await getManageableGuild(
          req,
          guildId
        );

      if (!guild) {
        req.session.selectedGuildId =
          null;

        return res.json({
          selected: null
        });
      }

      res.json({
        selected: guild
      });

    } catch (error) {
      console.error(
        'Selected guild error:',
        error
      );

      res.status(500).json({
        error:
          'SELECTED_GUILD_FAILED'
      });
    }
  }
);

/* ==================================================
   GUILD INFORMATION
================================================== */

app.get(
  '/api/guild/:guildId',
  requireLogin,
  async (req, res) => {
    try {
      const guildId =
        String(
          req.params.guildId
        );

      const accessGuild =
        await getManageableGuild(
          req,
          guildId
        );

      if (!accessGuild) {
        return res.status(403).json({
          error:
            'NO_ADMINISTRATOR_PERMISSION'
        });
      }

      const guild =
        getBotGuild(guildId);

      res.json({
        id:
          guild.id,

        name:
          guild.name,

        icon:
          guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`
            : null,

        members:
          guild.memberCount || 0,

        channels:
          guild.channels.cache.size,

        roles:
          guild.roles.cache.size,

        botPresent:
          true
      });

    } catch (error) {
      console.error(
        'Guild info error:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          'GUILD_INFO_FAILED'
      });
    }
  }
);

/* ==================================================
   CHANGE LOGS
================================================== */

app.get(
  '/api/guild/:guildId/change-logs',
  requireLogin,
  async (req, res) => {
    try {
      const guildId =
        String(
          req.params.guildId
        );

      const accessGuild =
        await getManageableGuild(
          req,
          guildId
        );

      if (!accessGuild) {
        return res.status(403).json({
          error:
            'NO_ADMINISTRATOR_PERMISSION'
        });
      }

      const guild =
        getBotGuild(guildId);

      const me =
        guild.members.me;

      if (!me) {
        return res.status(403).json({
          error:
            'BOT_MEMBER_NOT_AVAILABLE'
        });
      }

      if (
        !me.permissions.has(
          PermissionsBitField.Flags
            .ViewAuditLog
        )
      ) {
        return res.status(403).json({
          error:
            'BOT_MISSING_VIEW_AUDIT_LOG'
        });
      }

      const logs =
        await guild.fetchAuditLogs({
          limit: 50
        });

      const entries =
        [...logs.entries.values()]
          .map(
            mapAuditLogEntry
          );

      res.json({
        guildId,

        logs: entries,

        updatedAt:
          new Date().toISOString()
      });

    } catch (error) {
      console.error(
        'Change logs error:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          'CHANGE_LOGS_FAILED'
      });
    }
  }
);

/* ==================================================
   INVITE BOT
================================================== */

app.get(
  '/api/invite',
  (req, res) => {
    if (!CLIENT_ID) {
      return res.status(500).json({
        error:
          'CLIENT_ID_MISSING'
      });
    }

    const permissions =
      new PermissionsBitField([
        PermissionsBitField.Flags
          .ViewChannel,

        PermissionsBitField.Flags
          .SendMessages,

        PermissionsBitField.Flags
          .EmbedLinks,

        PermissionsBitField.Flags
          .ReadMessageHistory,

        PermissionsBitField.Flags
          .ViewAuditLog
      ])
        .bitfield
        .toString();

    const url =
      'https://discord.com/oauth2/authorize' +
      `?client_id=${encodeURIComponent(
        CLIENT_ID
      )}` +
      `&permissions=${permissions}` +
      '&scope=bot%20applications.commands';

    res.json({
      url
    });
  }
);

/* ==================================================
   DISCORD LOGIN
================================================== */

app.get(
  '/auth/discord',
  (req, res) => {
    if (
      !CLIENT_ID ||
      !CLIENT_SECRET
    ) {
      return res.status(500).send(
        'Discord OAuth is not configured. Check CLIENT_ID and CLIENT_SECRET.'
      );
    }

    req.session.oauthState =
      crypto
        .randomBytes(24)
        .toString('hex');

    const params =
      new URLSearchParams({
        client_id:
          CLIENT_ID,

        redirect_uri:
          REDIRECT_URI,

        response_type:
          'code',

        scope:
          'identify guilds',

        state:
          req.session.oauthState
      });

    res.redirect(
      `https://discord.com/oauth2/authorize?${params.toString()}`
    );
  }
);

/* ==================================================
   OAUTH CALLBACK
================================================== */

app.get(
  '/auth/discord/callback',
  async (req, res) => {
    try {
      const {
        code,
        state
      } = req.query;

      if (
        !code ||
        !state ||
        state !==
          req.session.oauthState
      ) {
        return res
          .status(400)
          .send(
            'Invalid Discord OAuth state.'
          );
      }

      delete req.session.oauthState;

      const tokenResponse =
        await fetch(
          `${DISCORD_API}/oauth2/token`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded'
            },

            body:
              new URLSearchParams({
                client_id:
                  CLIENT_ID,

                client_secret:
                  CLIENT_SECRET,

                grant_type:
                  'authorization_code',

                code:
                  String(code),

                redirect_uri:
                  REDIRECT_URI
              })
          }
        );

      if (!tokenResponse.ok) {
        const errorText =
          await tokenResponse.text();

        throw new Error(
          `OAuth token exchange failed: ${tokenResponse.status} ${errorText}`
        );
      }

      const token =
        await tokenResponse.json();

      const user =
        await discordRequest(
          '/users/@me',
          token.access_token
        );

      req.session.user = {
        id:
          user.id,

        username:
          user.username,

        globalName:
          user.global_name ||
          user.username,

        avatar:
          user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : 'https://cdn.discordapp.com/embed/avatars/0.png'
      };

      req.session.discordAccessToken =
        token.access_token;

      req.session.selectedGuildId =
        null;

      res.redirect('/');

    } catch (error) {
      console.error(
        'Discord OAuth error:',
        error
      );

      res
        .status(500)
        .send(
          'Discord login failed. Check the server console.'
        );
    }
  }
);

/* ==================================================
   LOGOUT
================================================== */

app.post(
  '/auth/logout',
  (req, res) => {
    req.session.destroy(
      () => {
        res.json({
          ok: true
        });
      }
    );
  }
);

/* ==================================================
   ANNOUNCEMENTS - GET
================================================== */

app.get(
  '/api/announcements',
  async (req, res) => {
    const channelId =
      req.query.channelId ||
      ANNOUNCEMENT_CHANNEL_ID;

    res.json({
      announcements:
        await getAnnouncements(
          channelId
        ),

      channelId
    });
  }
);

/* ==================================================
   ANNOUNCEMENTS - SEND
================================================== */

app.post(
  '/api/announcements',
  requireLogin,
  async (req, res) => {
    try {
      const content =
        String(
          req.body.content || ''
        ).trim();

      if (!content) {
        return res.status(400).json({
          error:
            'EMPTY_ANNOUNCEMENT'
        });
      }

      if (content.length > 2000) {
        return res.status(400).json({
          error:
            'MAX_2000_CHARACTERS'
        });
      }

      const guildId =
        String(
          req.body.guildId ||
          req.session.selectedGuildId ||
          ''
        );

      if (!guildId) {
        return res.status(400).json({
          error:
            'GUILD_NOT_SELECTED'
        });
      }

      const accessGuild =
        await getManageableGuild(
          req,
          guildId
        );

      if (!accessGuild) {
        return res.status(403).json({
          error:
            'NO_ADMINISTRATOR_PERMISSION'
        });
      }

      getBotGuild(guildId);

      const channelId =
        String(
          req.body.channelId ||
          ANNOUNCEMENT_CHANNEL_ID ||
          ''
        );

      if (!channelId) {
        return res.status(400).json({
          error:
            'CHANNEL_ID_REQUIRED'
        });
      }

      const channel =
        await getAnnouncementChannel(
          channelId
        );

      if (
        channel.guild &&
        channel.guild.id !== guildId
      ) {
        return res.status(403).json({
          error:
            'CHANNEL_NOT_IN_SELECTED_GUILD'
        });
      }

      const message =
        await channel.send({
          content:
            `📢 **Botrix Announcement**\n${content}`
        });

      res.json({
        ok: true,

        guildId,

        channelId,

        announcement:
          mapDiscordMessage(
            message
          )
      });

    } catch (error) {
      console.error(
        'Announcement send error:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          'ANNOUNCEMENT_SEND_FAILED'
      });
    }
  }
);

/* ==================================================
   HEALTH
================================================== */

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      online:
        client.isReady(),

      status:
        'OK',

      servers:
        client.guilds.cache.size,

      uptime:
        Math.floor(
          (Date.now() -
            stats.startedAt) /
            1000
        )
    });
  }
);

/* ==================================================
   SUPPORT / OPEN TICKET
================================================== */

app.get(
  '/api/support',
  (req, res) => {
    res.json({
      url:
        SUPPORT_INVITE
    });
  }
);

/* ==================================================
   BOT READY
================================================== */

client.once(
  'clientReady',
  () => {
    console.log(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );

    console.log(
      '🤖 BOTRIX SYSTEM'
    );

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🌐 Servers: ${client.guilds.cache.size}`
    );

    console.log(
      `📢 Announcement channel: ${
        ANNOUNCEMENT_CHANNEL_ID ||
        'Not configured'
      }`
    );

    console.log(
      `👑 Staff Guild: ${STAFF_GUILD_ID}`
    );

    console.log(
      `👥 Staff Roles: ${STAFF_ROLES.length}`
    );

    console.log(
      `🤝 Partner Role: ${PARTNER_ROLE_ID}`
    );

    console.log(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );
  }
);

/* ==================================================
   MESSAGES
================================================== */

client.on(
  'messageCreate',
  message => {
    if (message.author.bot) {
      return;
    }

    stats.messages++;
  }
);

/* ==================================================
   INTERACTIONS
================================================== */

client.on(
  'interactionCreate',
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    stats.commands++;

    if (
      interaction.commandName ===
      'ping'
    ) {
      try {
        await interaction.reply(
          `🏓 Pong! ${client.ws.ping}ms`
        );
      } catch (error) {
        console.error(
          'Ping command error:',
          error
        );
      }
    }
  }
);

/* ==================================================
   SERVER
================================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `🌐 Botrix.dashboard: ${BASE_URL}`
    );

    console.log(
      `🔗 Open: ${BASE_URL}`
    );
  }
);

/* ==================================================
   LOGIN BOT
================================================== */

if (
  !process.env.DISCORD_TOKEN
) {
  console.log(
    '❌ DISCORD_TOKEN is missing.'
  );
} else {
  client
    .login(
      process.env.DISCORD_TOKEN
    )
    .catch(error => {
      console.error(
        '❌ Discord login failed:',
        error.message
      );
    });
}