import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/error-codes';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        userId,
        title: dto.title,
        status: 'draft',
      },
    });
  }

  async findAll(userId: string, query: ListProjectsQueryDto) {
    const limit = query.limit ?? 20;
    const items = await this.prisma.project.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasNext = items.length > limit;
    const resultItems = hasNext ? items.slice(0, limit) : items;
    const nextCursor = hasNext ? resultItems[resultItems.length - 1]?.id ?? null : null;

    return {
      items: resultItems,
      nextCursor,
    };
  }

  async findOne(userId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!project) {
      throw new AppError(ErrorCodes.E_NOT_FOUND, 'Project not found', 404);
    }

    return project;
  }

  async softDelete(userId: string, id: string) {
    // Ownership check in where clause (never after fetching)
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
      },
    });

    if (!project) {
      throw new AppError(ErrorCodes.E_NOT_FOUND, 'Project not found', 404);
    }

    await this.prisma.project.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    return { success: true };
  }
}
