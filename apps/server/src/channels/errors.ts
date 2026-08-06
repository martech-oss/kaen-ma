export class PermanentChannelError extends Error {
  public override readonly name: string = "PermanentChannelError";
}

export class TransientChannelError extends Error {
  public override readonly name: string = "TransientChannelError";
}

export class RecipientSuppressedChannelError extends PermanentChannelError {
  public override readonly name = "RecipientSuppressedChannelError";
}
