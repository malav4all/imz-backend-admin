import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupQueryDto } from './dto/group-query.dto';
import { Group, GroupDocument } from './schema/group.schema';
import { PaginatedResponse } from 'src/comman/pagination.dto';

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
  ) {}

  async create(createGroupDto: CreateGroupDto): Promise<Group> {
    try {
      // Convert string IDs to ObjectIds
      const imeiObjectIds = createGroupDto.imei.map(
        (id) => new Types.ObjectId(id),
      );

      const createdGroup = new this.groupModel({
        ...createGroupDto,
        imei: imeiObjectIds,
      });

      return await createdGroup.save();
    } catch (error) {
      if (error.code === 11000) {
        throw new BadRequestException('Group with this name already exists');
      }
      throw new BadRequestException('Failed to create group: ' + error.message);
    }
  }

  async findAll(queryDto: GroupQueryDto): Promise<PaginatedResponse<Group>> {
    const { page = 1, limit = 10, search, ...filters } = queryDto;
    const skip = (page - 1) * limit;

    const filterQuery: any = {};

    // Global search
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      filterQuery.$or = [
        { groupName: searchRegex },
        { groupType: searchRegex },
        { stateName: searchRegex },
        { cityName: searchRegex },
        { contactNo: searchRegex },
        { remark: searchRegex },
      ];
    }

    // Specific filters
    if (filters.groupName) {
      filterQuery.groupName = { $regex: filters.groupName, $options: 'i' };
    }

    if (filters.groupType) {
      filterQuery.groupType = { $regex: filters.groupType, $options: 'i' };
    }

    if (filters.stateName) {
      filterQuery.stateName = { $regex: filters.stateName, $options: 'i' };
    }

    if (filters.cityName) {
      filterQuery.cityName = { $regex: filters.cityName, $options: 'i' };
    }

    try {
      const result = await this.groupModel.aggregate([
        { $match: filterQuery },

        {
          $lookup: {
            from: 'deviceonboardings',
            localField: 'imei',
            foreignField: '_id',
            as: 'imei',
          },
        },

        {
          $facet: {
            data: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: Number(limit) },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ]);

      const groups = result[0].data;
      const total = result[0].total[0]?.count || 0;

      return new PaginatedResponse(groups, page, limit, total);
    } catch (error) {
      throw new BadRequestException('Failed to fetch groups: ' + error.message);
    }
  }

  async findOne(id: string): Promise<Group> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid group ID format');
    }

    try {
      const group = await this.groupModel
        .findById(id)
        .populate('imei', 'deviceId serialNumber')
        .exec();

      if (!group) {
        throw new NotFoundException(`Group with ID ${id} not found`);
      }

      return group;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch group: ' + error.message);
    }
  }

  async update(id: string, updateGroupDto: UpdateGroupDto): Promise<Group> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid group ID format');
    }

    try {
      const updateData: any = { ...updateGroupDto };

      // Convert imei string IDs to ObjectIds if provided
      if (updateGroupDto.imei) {
        updateData.imei = updateGroupDto.imei.map(
          (id) => new Types.ObjectId(id),
        );
      }

      const updatedGroup = await this.groupModel
        .findByIdAndUpdate(id, updateData, {
          new: true,
          runValidators: true,
        })
        .populate('imei', 'deviceId serialNumber')
        .exec();

      if (!updatedGroup) {
        throw new NotFoundException(`Group with ID ${id} not found`);
      }

      return updatedGroup;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error.code === 11000) {
        throw new BadRequestException('Group with this name already exists');
      }
      throw new BadRequestException('Failed to update group: ' + error.message);
    }
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid group ID format');
    }

    try {
      const result = await this.groupModel.findByIdAndDelete(id).exec();

      if (!result) {
        throw new NotFoundException(`Group with ID ${id} not found`);
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to delete group: ' + error.message);
    }
  }
}
