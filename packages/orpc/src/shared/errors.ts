export const workspaceErrors = {
  UNAUTHORIZED: {
    status: 401,
    message: "ログインが必要です",
  },
  INVALID_API_KEY: {
    status: 401,
    message: "APIキーが無効です",
  },
  WORKSPACE_REQUIRED: {
    status: 403,
    message: "利用可能なワークスペースがありません",
  },
  ORIGIN_MISMATCH: {
    status: 403,
    message: "許可されていないOriginです",
  },
} as const;

export const forbiddenError = {
  FORBIDDEN: { status: 403, message: "この操作を行う権限がありません" },
} as const;

export const authedErrors = { ...workspaceErrors, ...forbiddenError } as const;
