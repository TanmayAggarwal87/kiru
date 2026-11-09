import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../../database/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/error-codes';

describe('ProjectsService (including IDOR tests)', () => {
  let service: ProjectsService;
  let prismaMock: {
    project: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  const userA = 'user-a-uuid';
  const userB = 'user-b-uuid';
  const project1Id = 'project-1-uuid';

  beforeEach(async () => {
    prismaMock = {
      project: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: project1Id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          // Mock data: project1 belongs to userA and is not deleted
          if (where.id === project1Id && where.userId === userA && where.deletedAt === null) {
            return Promise.resolve({
              id: project1Id,
              userId: userA,
              title: 'User A Project',
              status: 'draft',
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: project1Id,
          deletedAt: data.deletedAt,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create sets status to draft and scopes by userId', async () => {
    const project = await service.create(userA, { title: 'New Clip Show' });
    expect(prismaMock.project.create).toHaveBeenCalledWith({
      data: {
        userId: userA,
        title: 'New Clip Show',
        status: 'draft',
      },
    });
    expect(project.userId).toBe(userA);
  });

  it('findAll scopes query by userId and deletedAt null', async () => {
    await service.findAll(userA, { limit: 10 });
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        userId: userA,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 11,
    });
  });

  it('findOne succeeds when user is the owner', async () => {
    const project = await service.findOne(userA, project1Id);
    expect(project.id).toBe(project1Id);
    expect(project.userId).toBe(userA);
  });

  // IDOR TEST: User B cannot access User A's project (must return 404 NOT FOUND)
  it('IDOR: findOne throws 404 E_NOT_FOUND when user B tries to access user A project', async () => {
    await expect(service.findOne(userB, project1Id)).rejects.toThrow(AppError);
    try {
      await service.findOne(userB, project1Id);
    } catch (err: unknown) {
      expect((err as AppError).code).toBe(ErrorCodes.E_NOT_FOUND);
      expect((err as AppError).getStatus()).toBe(404);
    }
  });

  it('softDelete marks deletedAt when owner requests', async () => {
    const res = await service.softDelete(userA, project1Id);
    expect(res).toEqual({ success: true });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: project1Id },
      data: { deletedAt: expect.any(Date) },
    });
  });

  // IDOR TEST: User B cannot delete User A's project
  it('IDOR: softDelete throws 404 E_NOT_FOUND when user B tries to delete user A project', async () => {
    await expect(service.softDelete(userB, project1Id)).rejects.toThrow(AppError);
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });
});
