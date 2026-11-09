import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../../database/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let checkSpy: jest.Mock;

  beforeEach(async () => {
    checkSpy = jest.fn().mockImplementation((indicators: Array<() => Promise<unknown>>) => {
      return Promise.all(indicators.map((i) => i())).then(() => ({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      }));
    });

    const mockHealthService = {
      check: checkSpy,
    };

    const mockPrismaHealth = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };

    const mockPrismaService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthService },
        { provide: PrismaHealthIndicator, useValue: mockPrismaHealth },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return ok for liveness check', async () => {
    const res = await controller.checkLive();
    expect(res.status).toBe('ok');
    expect(checkSpy).toHaveBeenCalledWith([]);
  });

  it('should verify database ping for readiness check', async () => {
    const res = await controller.checkReady();
    expect(res.status).toBe('ok');
    expect(checkSpy).toHaveBeenCalled();
  });
});
