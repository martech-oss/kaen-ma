export class PermanentChannelError extends Error {
  public override readonly name = "PermanentChannelError";
}

export class TransientChannelError extends Error {
  public override readonly name = "TransientChannelError";
}
