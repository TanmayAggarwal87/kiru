import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../database/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prismaMock: { user: { upsert: jest.Mock } };

  beforeEach(async () => {
    prismaMock = {
      user: {
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('ensureUser should upsert user in database with free plan default', async () => {
    const user = await service.ensureUser({
      id: 'uuid-1',
      email: 'test@example.com',
      displayName: 'Test User',
    });

    expect(prismaMock.user.upsert).toHaveBeenCalledWith({
      where: { id: 'uuid-1' },
      update: {
        email: 'test@example.com',
        displayName: 'Test User',
      },
      create: {
        id: 'uuid-1',
        email: 'test@example.com',
        displayName: 'Test User',
        plan: 'free',
      },
    });
    expect(user.plan).toBe('free');
  });

  it('getMe returns user profile summary', async () => {
    const profile = await service.getMe({
      id: 'uuid-2',
      email: 'test2@example.com',
    });

    expect(profile.id).toBe('uuid-2');
    expect(profile.email).toBe('test2@example.com');
    expect(profile.plan).toBe('free');
  });
});
