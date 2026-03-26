export const USER_STATUS_REQUIRES_INVITE = 0;
export const USER_STATUS_ACTIVE = 1;
export const USER_STATUS_DISABLED = 2;

export type UserStatus =
  | typeof USER_STATUS_REQUIRES_INVITE
  | typeof USER_STATUS_ACTIVE
  | typeof USER_STATUS_DISABLED;

export function isUserStatus(value: unknown): value is UserStatus {
  return value === USER_STATUS_REQUIRES_INVITE
    || value === USER_STATUS_ACTIVE
    || value === USER_STATUS_DISABLED;
}
