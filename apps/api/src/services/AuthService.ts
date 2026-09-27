import { isUniqueViolation, type PrismaClient } from '@extract/database';
import { ECONOMY_CONFIG } from '@extract/game-config';
import type { AuthResponse, UserDTO } from '@extract/game-types';
import { signAccessToken } from '@extract/server-core';
import { isValidUsername } from '@extract/shared';
import { hashPassword, verifyPassword } from '../auth/password';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../errors';
import { toUserDTO } from '../mappers';

const MIN_PASSWORD = 8;

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly jwtSecret: string,
  ) {}

  private issue(user: Parameters<typeof toUserDTO>[0]): AuthResponse {
    return { token: signAccessToken({ userId: user.id, username: user.username }, this.jwtSecret), user: toUserDTO(user) };
  }

  private assertUsername(username: unknown): asserts username is string {
    if (!isValidUsername(username)) throw badRequest('Username must be 3-16 characters: letters, numbers, _ or -', 'invalid_username');
  }

  /** Guest mode: username only, play immediately. */
  async createGuest(username: string): Promise<AuthResponse> {
    this.assertUsername(username);
    try {
      const user = await this.db.user.create({
        data: {
          username,
          usernameLower: username.toLowerCase(),
          isGuest: true,
          profile: { create: { balanceCents: ECONOMY_CONFIG.startingBalanceCents } },
          inventory: { create: {} },
        },
        include: { profile: true },
      });
      return this.issue(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Username is already taken', 'username_taken');
      throw err;
    }
  }

  /**
   * Optional registration. A signed-in guest is upgraded in place (keeping
   * inventory and stats); otherwise a new account is created.
   */
  async register(username: string, password: string, currentUserId: string | null): Promise<AuthResponse> {
    this.assertUsername(username);
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw badRequest(`Password must be at least ${MIN_PASSWORD} characters`, 'weak_password');
    }
    const passwordHash = await hashPassword(password);
    try {
      if (currentUserId) {
        const current = await this.db.user.findUnique({ where: { id: currentUserId } });
        if (!current) throw unauthorized();
        if (!current.isGuest) throw badRequest('Account is already registered', 'already_registered');
        const user = await this.db.user.update({
          where: { id: currentUserId },
          data: { username, usernameLower: username.toLowerCase(), passwordHash, isGuest: false },
          include: { profile: true },
        });
        return this.issue(user);
      }
      const user = await this.db.user.create({
        data: {
          username,
          usernameLower: username.toLowerCase(),
          passwordHash,
          isGuest: false,
          profile: { create: { balanceCents: ECONOMY_CONFIG.startingBalanceCents } },
          inventory: { create: {} },
        },
        include: { profile: true },
      });
      return this.issue(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Username is already taken', 'username_taken');
      throw err;
    }
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    if (typeof username !== 'string' || typeof password !== 'string') throw unauthorized('Invalid credentials');
    const user = await this.db.user.findUnique({ where: { usernameLower: username.toLowerCase() }, include: { profile: true } });
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError(401, 'invalid_credentials', 'Invalid username or password');
    }
    return this.issue(user);
  }

  async me(userId: string): Promise<UserDTO> {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) throw notFound('User not found');
    return toUserDTO(user);
  }
}
