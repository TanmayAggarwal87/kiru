import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

describe('ProjectsController', () => {
  let controller: ProjectsController;

  const createSpy = jest.fn().mockResolvedValue({ id: 'proj-1', title: 'Test Project' });
  const findAllSpy = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const findOneSpy = jest.fn().mockResolvedValue({ id: 'proj-1', title: 'Test Project' });
  const softDeleteSpy = jest.fn().mockResolvedValue({ success: true });

  const mockUser: AuthenticatedUser = {
    id: 'user-1',
    email: 'user1@example.com',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockProjectsService = {
      create: createSpy,
      findAll: findAllSpy,
      findOne: findOneSpy,
      softDelete: softDeleteSpy,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: mockProjectsService }],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create delegates to service with user.id', async () => {
    await controller.create(mockUser, { title: 'Test Project' });
    expect(createSpy).toHaveBeenCalledWith('user-1', { title: 'Test Project' });
  });

  it('findAll delegates to service with user.id and query', async () => {
    await controller.findAll(mockUser, { limit: 10 });
    expect(findAllSpy).toHaveBeenCalledWith('user-1', { limit: 10 });
  });

  it('findOne delegates to service with user.id and id', async () => {
    await controller.findOne(mockUser, 'proj-1');
    expect(findOneSpy).toHaveBeenCalledWith('user-1', 'proj-1');
  });

  it('remove delegates to service.softDelete with user.id and id', async () => {
    await controller.remove(mockUser, 'proj-1');
    expect(softDeleteSpy).toHaveBeenCalledWith('user-1', 'proj-1');
  });
});
