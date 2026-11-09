import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface EnsureUserData {
  id: string;
  email: string;
  displayName?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureUser(data: EnsureUserData) {
    return this.prisma.user.upsert({
      where: { id: data.id },
      update: {
        email: data.email,
        ...(data.displayName ? { displayName: data.displayName } : {}),
      },
      create: {
        id: data.id,
        email: data.email,
        displayName: data.displayName,
        plan: 'free',
      },
    });
  }

  async getMe(data: EnsureUserData) {
    const user = await this.ensureUser(data);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      plan: user.plan,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
