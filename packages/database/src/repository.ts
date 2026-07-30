import type { Account, AccountCreate, AccountUpdate, WorkspaceContext } from "@kaenma/shared";

import { AccountRepository, type AccountSummary } from "./accounts/repository";
import type { DatabaseSource } from "./client";
import { ContactRepository } from "./contacts/repository";

export * from "./accounts/repository";
export * from "./audit/repository";
export * from "./campaigns/repository";
export * from "./contacts/repository";
export * from "./operations/repository";
export * from "./workspaces/repository";
export * from "./shared/uuid";

/** @deprecated Prefer the domain-specific ContactRepository and AccountRepository. */
export class WorkspaceRepository extends ContactRepository {
  private readonly accounts: AccountRepository;

  public constructor(database: DatabaseSource, context: WorkspaceContext) {
    super(database, context);
    this.accounts = new AccountRepository(database, context);
  }

  public listAccounts(input: { query?: string; limit?: number }): Promise<AccountSummary[]> {
    return this.accounts.listAccounts(input);
  }

  public getAccount(id: string): Promise<Account | null> {
    return this.accounts.getAccount(id);
  }

  public createAccount(input: AccountCreate): Promise<Account> {
    return this.accounts.createAccount(input);
  }

  public updateAccount(id: string, input: AccountUpdate): Promise<Account | null> {
    return this.accounts.updateAccount(id, input);
  }
}
