import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

describe('UsersController', () => {
  let controller: UsersController;
  let getMeSpy: jest.Mock;

  beforeEach(async () => {
    getMeSpy = jest.fn().mockResolvedValue({
      id: 'user-123',
      email: 'test@example.com',
      displayName: 'Test User',
      plan: 'free',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockUsersService = {
      getMe: getMeSpy,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getMe should call usersService.getMe with authenticated user details', async () => {
    const mockUser: AuthenticatedUser = {
      id: 'user-123',
      email: 'test@example.com',
      payload: {
        user_metadata: {
          full_name: 'Test User',
        },
      },
    };

    const result = await controller.getMe(mockUser);

    expect(getMeSpy).toHaveBeenCalledWith({
      id: 'user-123',
      email: 'test@example.com',
      displayName: 'Test User',
    });
    expect(result.id).toBe('user-123');
    expect(result.email).toBe('test@example.com');
  });
});
