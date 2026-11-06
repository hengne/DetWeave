/* Official-document snapshot. No keys; no automatic network lookup. */
window.DETWEAVE_PROVIDERS = [
  {
    "id": "ark-coding",
    "label": {
      "zh": "火山 Coding Plan",
      "en": "Volcengine Coding Plan"
    },
    "kind": "openai",
    "base_url": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "models": [
      {
        "id": "ark-code-latest",
        "label": {
          "zh": "ark-code-latest · 跟随控制台 / Auto",
          "en": "ark-code-latest · console route / Auto"
        }
      },
      {
        "id": "doubao-seed-evolving",
        "label": {
          "zh": "doubao-seed-evolving",
          "en": "doubao-seed-evolving"
        }
      },
      {
        "id": "doubao-seed-2.1-pro",
        "label": {
          "zh": "doubao-seed-2.1-pro",
          "en": "doubao-seed-2.1-pro"
        }
      },
      {
        "id": "doubao-seed-2.1-lite",
        "label": {
          "zh": "doubao-seed-2.1-lite",
          "en": "doubao-seed-2.1-lite"
        }
      },
      {
        "id": "doubao-seed-2.0-mini",
        "label": {
          "zh": "doubao-seed-2.0-mini",
          "en": "doubao-seed-2.0-mini"
        }
      },
      {
        "id": "glm-5.3",
        "label": {
          "zh": "glm-5.3",
          "en": "glm-5.3"
        }
      },
      {
        "id": "glm-5.3-flash",
        "label": {
          "zh": "glm-5.3-flash",
          "en": "glm-5.3-flash"
        }
      },
      {
        "id": "glm-latest",
        "label": {
          "zh": "glm-latest · glm-5.3 别名",
          "en": "glm-latest · alias for glm-5.3"
        }
      },
      {
        "id": "deepseek-v4.1-flash",
        "label": {
          "zh": "deepseek-v4.1-flash",
          "en": "deepseek-v4.1-flash"
        }
      },
      {
        "id": "deepseek-v4.1-flash-economy",
        "label": {
          "zh": "deepseek-v4.1-flash-economy",
          "en": "deepseek-v4.1-flash-economy"
        }
      },
      {
        "id": "deepseek-v4-flash",
        "label": {
          "zh": "deepseek-v4-flash",
          "en": "deepseek-v4-flash"
        }
      },
      {
        "id": "deepseek-v4-pro",
        "label": {
          "zh": "deepseek-v4-pro",
          "en": "deepseek-v4-pro"
        }
      },
      {
        "id": "kimi-k2.8-preview",
        "label": {
          "zh": "kimi-k2.8-preview",
          "en": "kimi-k2.8-preview"
        }
      },
      {
        "id": "kimi-k3",
        "label": {
          "zh": "kimi-k3",
          "en": "kimi-k3"
        }
      },
      {
        "id": "kimi-k3.1-pro",
        "label": {
          "zh": "kimi-k3.1-pro",
          "en": "kimi-k3.1-pro"
        }
      }
    ],
    "default_model": "ark-code-latest",
    "summary": {
      "zh": "Lite / Pro 订阅；13 个生成模型、路由入口及别名。ark-code-latest 跟随控制台，选为 Auto 才自动路由。套餐使用范围以官方说明为准。",
      "en": "Lite / Pro subscription; 13 generation models, a route and an alias. ark-code-latest follows the console selection; Auto must be selected there. Check official plan eligibility."
    },
    "sources": [
      {
        "label": {
          "zh": "配置与模型",
          "en": "Configuration and models"
        },
        "url": "https://docs.volcengine.com/docs/ark/coding-plan-personal-ai-other-tools?lang=zh"
      },
      {
        "label": {
          "zh": "套餐说明",
          "en": "Plan overview"
        },
        "url": "https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh"
      }
    ],
    "verified_at": "2026-11-06",
    "thinking": "ark"
  },
  {
    "id": "deepseek-official",
    "label": {
      "zh": "DeepSeek 官方 API · 按量",
      "en": "DeepSeek official API · metered"
    },
    "kind": "openai",
    "base_url": "https://api.deepseek.com",
    "models": [
      {
        "id": "deepseek-flash",
        "label": {
          "zh": "deepseek-flash",
          "en": "deepseek-flash"
        }
      },
      {
        "id": "deepseek-v4-pro",
        "label": {
          "zh": "deepseek-v4-pro",
          "en": "deepseek-v4-pro"
        }
      }
    ],
    "default_model": "deepseek-flash",
    "summary": {
      "zh": "官方按量 API。deepseek-flash 当前由 DeepSeek-V4.1-Flash-1017 提供；不是火山或其他平台订阅。",
      "en": "Official metered API. deepseek-flash currently resolves to DeepSeek-V4.1-Flash-1017; separate from reseller subscriptions."
    },
    "sources": [
      {
        "label": {
          "zh": "官方接口",
          "en": "Official API"
        },
        "url": "https://api-docs.deepseek.com/"
      },
      {
        "label": {
          "zh": "用量定价",
          "en": "Usage pricing"
        },
        "url": "https://api-docs.deepseek.com/quick_start/pricing"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "kimi-coding",
    "label": {
      "zh": "Kimi Code · 官方订阅",
      "en": "Kimi Code · official subscription"
    },
    "kind": "openai",
    "base_url": "https://api.kimi.com/coding/v1",
    "models": [
      {
        "id": "kimi-for-coding",
        "label": {
          "zh": "kimi-for-coding · K2.8 Preview",
          "en": "kimi-for-coding · K2.8 Preview"
        }
      },
      {
        "id": "k3.1-pro",
        "label": {
          "zh": "k3.1-pro",
          "en": "k3.1-pro"
        }
      },
      {
        "id": "k3.1-pro-highspeed",
        "label": {
          "zh": "k3.1-pro-highspeed · Pro 起",
          "en": "k3.1-pro-highspeed · Pro and above"
        }
      },
      {
        "id": "k3",
        "label": {
          "zh": "k3",
          "en": "k3"
        }
      },
      {
        "id": "k3-256k",
        "label": {
          "zh": "k3-256k",
          "en": "k3-256k"
        }
      },
      {
        "id": "kimi-for-coding-highspeed",
        "label": {
          "zh": "kimi-for-coding-highspeed · Pro 起",
          "en": "kimi-for-coding-highspeed · Pro and above"
        }
      }
    ],
    "default_model": "kimi-for-coding",
    "summary": {
      "zh": "6 个官方 Coding ID，套餐档位决定模型权限。保留服务商默认思考；K3.1 Pro 不支持关闭思考。与 Moonshot 按量 API 分开。",
      "en": "Six official Coding IDs; model access depends on membership. Provider-default thinking is retained; K3.1 Pro requires thinking. Separate from Moonshot metered API."
    },
    "sources": [
      {
        "label": {
          "zh": "模型与档位",
          "en": "Models and membership tiers"
        },
        "url": "https://www.kimi.com/code/docs/en/kimi-code/models.html"
      },
      {
        "label": {
          "zh": "订阅说明",
          "en": "Membership guide"
        },
        "url": "https://www.kimi.com/en/help/kimi-code/membership-guide"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "glm-coding",
    "label": {
      "zh": "GLM Coding Plan · 智谱官方订阅",
      "en": "GLM Coding Plan · BigModel subscription"
    },
    "kind": "openai",
    "base_url": "https://open.bigmodel.cn/api/coding/paas/v4",
    "models": [
      {
        "id": "glm-5.3",
        "label": {
          "zh": "glm-5.3",
          "en": "glm-5.3"
        }
      },
      {
        "id": "glm-5.3-flash",
        "label": {
          "zh": "glm-5.3-flash",
          "en": "glm-5.3-flash"
        }
      }
    ],
    "default_model": "glm-5.3",
    "summary": {
      "zh": "Lite / Pro / Max，另有团队版。仅适用于官方指定工具与产品环境；此处整理接口配置，不代表 DetWeave 已获套餐接入许可。",
      "en": "Lite / Pro / Max and team plans. Restricted to officially supported tools and product environments; listing configuration does not establish DetWeave plan eligibility."
    },
    "sources": [
      {
        "label": {
          "zh": "套餐与模型",
          "en": "Plans and models"
        },
        "url": "https://docs.bigmodel.cn/cn/coding-plan/overview"
      },
      {
        "label": {
          "zh": "接入与适用范围",
          "en": "Endpoint and eligible tools"
        },
        "url": "https://docs.bigmodel.cn/cn/coding-plan/tool/others"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "bailian-token",
    "label": {
      "zh": "阿里云百炼 Token Plan",
      "en": "Alibaba Cloud Model Studio Token Plan"
    },
    "kind": "openai",
    "base_url": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "models": [
      {
        "id": "auto",
        "label": {
          "zh": "auto",
          "en": "auto"
        }
      },
      {
        "id": "qwen3.8-max",
        "label": {
          "zh": "qwen3.8-max",
          "en": "qwen3.8-max"
        }
      },
      {
        "id": "qwen3.8-flash",
        "label": {
          "zh": "qwen3.8-flash",
          "en": "qwen3.8-flash"
        }
      },
      {
        "id": "qwen3.7-max",
        "label": {
          "zh": "qwen3.7-max",
          "en": "qwen3.7-max"
        }
      },
      {
        "id": "qwen3.7-plus",
        "label": {
          "zh": "qwen3.7-plus",
          "en": "qwen3.7-plus"
        }
      },
      {
        "id": "qwen3.6-flash",
        "label": {
          "zh": "qwen3.6-flash",
          "en": "qwen3.6-flash"
        }
      },
      {
        "id": "deepseek-v4.1-flash",
        "label": {
          "zh": "deepseek-v4.1-flash",
          "en": "deepseek-v4.1-flash"
        }
      },
      {
        "id": "deepseek-v4-pro",
        "label": {
          "zh": "deepseek-v4-pro",
          "en": "deepseek-v4-pro"
        }
      },
      {
        "id": "deepseek-v4-pro-0813",
        "label": {
          "zh": "deepseek-v4-pro-0813",
          "en": "deepseek-v4-pro-0813"
        }
      },
      {
        "id": "deepseek-v4-flash-0731",
        "label": {
          "zh": "deepseek-v4-flash-0731",
          "en": "deepseek-v4-flash-0731"
        }
      },
      {
        "id": "glm-5.3",
        "label": {
          "zh": "glm-5.3",
          "en": "glm-5.3"
        }
      },
      {
        "id": "glm-5.2",
        "label": {
          "zh": "glm-5.2",
          "en": "glm-5.2"
        }
      }
    ],
    "default_model": "auto",
    "summary": {
      "zh": "北京地域；个人版 Lite / Essential / Standard / Pro，另有团队版。此处列个人版文本生成模型。Token Plan 与旧 Coding Plan 的地址和凭据不同；文档对自研工具适用范围有差异，使用前以账号合同及平台确认为准。",
      "en": "Beijing region; personal Lite / Essential / Standard / Pro, plus team plans. Personal text-generation models are listed. Token Plan and legacy Coding Plan use different endpoints and credentials. Official pages differ on custom-tool eligibility; confirm account terms with the provider."
    },
    "sources": [
      {
        "label": {
          "zh": "套餐与模型",
          "en": "Plans and models"
        },
        "url": "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview"
      },
      {
        "label": {
          "zh": "接口地址",
          "en": "Base URL"
        },
        "url": "https://help.aliyun.com/zh/model-studio/base-url"
      },
      {
        "label": {
          "zh": "适用范围",
          "en": "Eligibility"
        },
        "url": "https://help.aliyun.com/zh/model-studio/more-tools"
      },
      {
        "label": {
          "zh": "产品概述",
          "en": "Product overview"
        },
        "url": "https://help.aliyun.com/zh/model-studio/token-plan-overview"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "tencent-hy",
    "label": {
      "zh": "腾讯混元 Hy Token Plan",
      "en": "Tencent Hunyuan Hy Token Plan"
    },
    "kind": "openai",
    "base_url": "https://tokenhub.tencentmaas.com/plan/v3",
    "models": [
      {
        "id": "hy4",
        "label": {
          "zh": "hy4",
          "en": "hy4"
        }
      },
      {
        "id": "hy4-preview",
        "label": {
          "zh": "hy4-preview",
          "en": "hy4-preview"
        }
      },
      {
        "id": "hy3",
        "label": {
          "zh": "hy3",
          "en": "hy3"
        }
      }
    ],
    "default_model": "hy4",
    "summary": {
      "zh": "混元专属订阅。Lite / Standard / Pro / Max：28 / 78 / 238 / 468 元每月（核对日标价）；560 / 1560 / 4760 / 9360 月积分。订阅限官方允许的交互式 AI 工具场景。",
      "en": "Hunyuan subscription. Lite / Standard / Pro / Max: CNY 28 / 78 / 238 / 468 per month at verification; 560 / 1560 / 4760 / 9360 monthly credits. Restricted to provider-approved interactive AI-tool use."
    },
    "sources": [
      {
        "label": {
          "zh": "套餐详情与模型",
          "en": "Plan details and models"
        },
        "url": "https://cloud.tencent.com/document/product/1823/130060"
      },
      {
        "label": {
          "zh": "接入配置",
          "en": "Connection settings"
        },
        "url": "https://cloud.tencent.com/document/product/1823/130119/"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "tencent-token",
    "label": {
      "zh": "腾讯通用 Token Plan · 多模型",
      "en": "Tencent General Token Plan · multi-model"
    },
    "kind": "openai",
    "base_url": "https://tokenhub.tencentmaas.com/plan/v3",
    "models": [
      {
        "id": "tc-code-latest",
        "label": {
          "zh": "tc-code-latest",
          "en": "tc-code-latest"
        }
      },
      {
        "id": "deepseek-v4.1-flash-1017",
        "label": {
          "zh": "deepseek-v4.1-flash-1017",
          "en": "deepseek-v4.1-flash-1017"
        }
      },
      {
        "id": "deepseek-v4-pro-0813",
        "label": {
          "zh": "deepseek-v4-pro-0813",
          "en": "deepseek-v4-pro-0813"
        }
      },
      {
        "id": "deepseek/deepseek-flash",
        "label": {
          "zh": "deepseek/deepseek-flash",
          "en": "deepseek/deepseek-flash"
        }
      },
      {
        "id": "hy4",
        "label": {
          "zh": "hy4",
          "en": "hy4"
        }
      },
      {
        "id": "hy4-preview",
        "label": {
          "zh": "hy4-preview",
          "en": "hy4-preview"
        }
      },
      {
        "id": "minimax-m3",
        "label": {
          "zh": "minimax-m3",
          "en": "minimax-m3"
        }
      },
      {
        "id": "glm-5.3",
        "label": {
          "zh": "glm-5.3",
          "en": "glm-5.3"
        }
      },
      {
        "id": "glm-5.3-flash",
        "label": {
          "zh": "glm-5.3-flash",
          "en": "glm-5.3-flash"
        }
      },
      {
        "id": "kimi-k2.7-code",
        "label": {
          "zh": "kimi-k2.7-code",
          "en": "kimi-k2.7-code"
        }
      },
      {
        "id": "kimi-k3",
        "label": {
          "zh": "kimi-k3",
          "en": "kimi-k3"
        }
      },
      {
        "id": "mimo-v2.6-flash",
        "label": {
          "zh": "mimo-v2.6-flash",
          "en": "mimo-v2.6-flash"
        }
      },
      {
        "id": "glm-5.2",
        "label": {
          "zh": "glm-5.2",
          "en": "glm-5.2"
        }
      },
      {
        "id": "deepseek/deepseek-v4-flash-0731",
        "label": {
          "zh": "deepseek/deepseek-v4-flash-0731",
          "en": "deepseek/deepseek-v4-flash-0731"
        }
      },
      {
        "id": "deepseek/deepseek-v4-pro-0813",
        "label": {
          "zh": "deepseek/deepseek-v4-pro-0813",
          "en": "deepseek/deepseek-v4-pro-0813"
        }
      },
      {
        "id": "minimax-m2.7",
        "label": {
          "zh": "minimax-m2.7 · 2026-11-17 下线",
          "en": "minimax-m2.7 · retires 2026-11-17"
        }
      }
    ],
    "default_model": "tc-code-latest",
    "summary": {
      "zh": "Lite / Standard / Pro / Max：39 / 99 / 299 / 599 元每月（核对日标价），780 / 1980 / 5980 / 11980 月积分。与 Hy Plan 共用密钥，但模型范围不同；限官方允许的交互式 AI 工具。",
      "en": "Lite / Standard / Pro / Max: CNY 39 / 99 / 299 / 599 per month at verification; 780 / 1980 / 5980 / 11980 monthly credits. Shares the plan key with Hy Plan, but model eligibility differs; approved interactive AI tools only."
    },
    "sources": [
      {
        "label": {
          "zh": "套餐详情与模型",
          "en": "Plan details and models"
        },
        "url": "https://cloud.tencent.com/document/product/1823/130060"
      },
      {
        "label": {
          "zh": "接入配置",
          "en": "Connection settings"
        },
        "url": "https://cloud.tencent.com/document/product/1823/130119/"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "openai-official",
    "label": {
      "zh": "OpenAI 官方 API · 按量",
      "en": "OpenAI official API · metered"
    },
    "kind": "openai",
    "base_url": "https://api.openai.com/v1",
    "models": [
      {
        "id": "gpt-6.1-sol",
        "label": {
          "zh": "gpt-6.1-sol",
          "en": "gpt-6.1-sol"
        }
      },
      {
        "id": "gpt-6.1-terra",
        "label": {
          "zh": "gpt-6.1-terra",
          "en": "gpt-6.1-terra"
        }
      },
      {
        "id": "gpt-6-astra",
        "label": {
          "zh": "gpt-6-astra",
          "en": "gpt-6-astra"
        }
      },
      {
        "id": "gpt-6-luna",
        "label": {
          "zh": "gpt-6-luna",
          "en": "gpt-6-luna"
        }
      },
      {
        "id": "gpt-4.1",
        "label": {
          "zh": "gpt-4.1",
          "en": "gpt-4.1"
        }
      }
    ],
    "default_model": "gpt-6.1-sol",
    "summary": {
      "zh": "使用 OpenAI API 凭据和对应 API 额度。本列表使用 Chat Completions 文本提取；不启用工具调用。",
      "en": "Use OpenAI API credentials and applicable API credits. This list uses Chat Completions for text extraction, without tool calls."
    },
    "sources": [
      {
        "label": {
          "zh": "当前模型",
          "en": "Current models"
        },
        "url": "https://developers.openai.com/api/docs/guides/latest-model"
      },
      {
        "label": {
          "zh": "GPT-4.1",
          "en": "GPT-4.1"
        },
        "url": "https://developers.openai.com/api/docs/models/gpt-4.1"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "anthropic-official",
    "label": {
      "zh": "Anthropic Claude 官方 API",
      "en": "Anthropic Claude official API"
    },
    "kind": "anthropic",
    "base_url": "https://api.anthropic.com/v1",
    "models": [
      {
        "id": "claude-sonnet-5-5",
        "label": {
          "zh": "claude-sonnet-5-5",
          "en": "claude-sonnet-5-5"
        }
      },
      {
        "id": "claude-opus-5-5",
        "label": {
          "zh": "claude-opus-5-5",
          "en": "claude-opus-5-5"
        }
      },
      {
        "id": "claude-fable-5-1",
        "label": {
          "zh": "claude-fable-5-1",
          "en": "claude-fable-5-1"
        }
      },
      {
        "id": "claude-haiku-5-5",
        "label": {
          "zh": "claude-haiku-5-5",
          "en": "claude-haiku-5-5"
        }
      }
    ],
    "default_model": "claude-sonnet-5-5",
    "summary": {
      "zh": "Claude Messages API；使用 API 凭据和对应额度，模型权限以账号为准。",
      "en": "Claude Messages API; use API credentials and applicable credits. Account access determines availability."
    },
    "sources": [
      {
        "label": {
          "zh": "模型目录",
          "en": "Model catalog"
        },
        "url": "https://platform.claude.com/docs/en/models/overview"
      }
    ],
    "verified_at": "2026-11-06"
  },
  {
    "id": "google-official",
    "label": {
      "zh": "Google Gemini 官方 API",
      "en": "Google Gemini official API"
    },
    "kind": "gemini",
    "base_url": "https://generativelanguage.googleapis.com/v1beta",
    "models": [
      {
        "id": "gemini-3.8-flash",
        "label": {
          "zh": "gemini-3.8-flash",
          "en": "gemini-3.8-flash"
        }
      },
      {
        "id": "gemini-3.6-flash",
        "label": {
          "zh": "gemini-3.6-flash",
          "en": "gemini-3.6-flash"
        }
      },
      {
        "id": "gemini-3.5-flash-lite",
        "label": {
          "zh": "gemini-3.5-flash-lite",
          "en": "gemini-3.5-flash-lite"
        }
      },
      {
        "id": "gemini-3.1-pro-preview",
        "label": {
          "zh": "gemini-3.1-pro-preview",
          "en": "gemini-3.1-pro-preview"
        }
      }
    ],
    "default_model": "gemini-3.8-flash",
    "summary": {
      "zh": "Gemini Developer API；模型与额度以 AI Studio 账号为准。Preview 型号可能变化。",
      "en": "Gemini Developer API; models and quota depend on your AI Studio account. Preview model availability may change."
    },
    "sources": [
      {
        "label": {
          "zh": "模型目录",
          "en": "Model catalog"
        },
        "url": "https://ai.google.dev/gemini-api/docs/models?hl=en"
      }
    ],
    "verified_at": "2026-11-06"
  }
];
