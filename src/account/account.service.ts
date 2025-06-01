// account.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Account, AccountDocument } from './schema/account.schema';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountService {
  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
  ) {}

  async create(createAccountDto: CreateAccountDto): Promise<Account> {
    const { accountName, parentAccount, clientId } = createAccountDto;

    let level = 1;
    let hierarchyPath = '';
    let parentDoc: any = null;

    // If parentAccount is provided, validate and get parent details
    if (parentAccount) {
      parentDoc = await this.accountModel.findById(parentAccount);
      if (!parentDoc) {
        throw new NotFoundException('Parent account not found');
      }

      // Check if parent is already at level 5
      if (parentDoc.level >= 5) {
        throw new BadRequestException('Cannot create account beyond level 5');
      }

      level = parentDoc.level + 1;

      // Count existing children to create the path
      const childCount = await this.accountModel.countDocuments({
        parentAccount: parentAccount,
      });

      hierarchyPath = parentDoc.hierarchyPath
        ? `${parentDoc.hierarchyPath}.${childCount + 1}`
        : `${childCount + 1}`;
    } else {
      // This is a top-level account
      const topLevelCount = await this.accountModel.countDocuments({
        level: 1,
        clientId: clientId,
      });
      hierarchyPath = `${topLevelCount + 1}`;
    }

    // Create the account
    const createdAccount = new this.accountModel({
      accountName,
      parentAccount: parentAccount ? new Types.ObjectId(parentAccount) : null,
      clientId: new Types.ObjectId(clientId),
      level,
      hierarchyPath,
    });

    const savedAccount = await createdAccount.save();

    // Update parent's children array if parent exists
    if (parentDoc) {
      await this.accountModel.findByIdAndUpdate(parentAccount, {
        $push: { children: savedAccount._id },
      });
    }

    return savedAccount;
  }

  async findAll(clientId: string): Promise<Account[]> {
    return this.accountModel
      .find({ clientId: new Types.ObjectId(clientId) })
      .populate('parentAccount', 'accountName level')
      .populate('children', 'accountName level')
      .exec();
  }

  async findOne(id: string): Promise<Account> {
    const account = await this.accountModel
      .findById(id)
      .populate('parentAccount', 'accountName level')
      .populate('children', 'accountName level')
      .exec();

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  async findAccountHierarchy(accountId: string): Promise<any> {
    const account: any = await this.accountModel.findById(accountId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return this.buildHierarchyTree(account._id.toString());
  }

  private async buildHierarchyTree(accountId: string): Promise<any> {
    const account = await this.accountModel
      .findById(accountId)
      .populate('children')
      .exec();

    if (!account) return null;

    const children = await Promise.all(
      account.children.map((childId) =>
        this.buildHierarchyTree(childId.toString()),
      ),
    );

    return {
      _id: account._id,
      accountName: account.accountName,
      level: account.level,
      hierarchyPath: account.hierarchyPath,
      children: children.filter((child) => child !== null),
    };
  }

  async findByLevel(level: number, clientId: string): Promise<Account[]> {
    if (level < 1 || level > 5) {
      throw new BadRequestException('Level must be between 1 and 5');
    }

    return this.accountModel
      .find({
        level,
        clientId: new Types.ObjectId(clientId),
      })
      .populate('parentAccount', 'accountName')
      .exec();
  }

  async findDescendants(accountId: string): Promise<Account[]> {
    const account = await this.accountModel.findById(accountId);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    // Find all accounts whose hierarchyPath starts with the current account's path
    return this.accountModel
      .find({
        hierarchyPath: new RegExp(`^${account.hierarchyPath}`),
        _id: { $ne: account._id },
      })
      .exec();
  }

  async update(id: string, updateAccountDto: any): Promise<any> {
    const account = await this.accountModel.findById(id);
    if (!account) throw new NotFoundException('Account not found');

    const oldParentId = account.parentAccount?.toString();
    const newParentId = updateAccountDto.parentAccount;

    let newHierarchyPath = '';
    let newLevel = 1;

    if (newParentId) {
      const parentAccount: any = await this.accountModel.findById(newParentId);
      if (!parentAccount)
        throw new NotFoundException('Parent account not found');

      newLevel = parentAccount.level + 1;

      const siblingCount = await this.accountModel.countDocuments({
        parentAccount: newParentId,
      });

      const nextIndex = siblingCount + 1;
      newHierarchyPath = `${parentAccount.hierarchyPath}.${nextIndex}`;
    } else {
      newHierarchyPath = '1';
      newLevel = 1;
    }

    const { level, hierarchyPath, ...safeUpdateDto } = updateAccountDto;

    // Update account
    const updatedAccount = await this.accountModel
      .findByIdAndUpdate(
        id,
        {
          ...safeUpdateDto,
          parentAccount: newParentId || null,
          hierarchyPath: newHierarchyPath,
          level: newLevel,
        },
        { new: true },
      )
      .populate('parentAccount', 'accountName level')
      .populate('children', 'accountName level');

    if (oldParentId && oldParentId !== newParentId) {
      await this.accountModel.findByIdAndUpdate(oldParentId, {
        $pull: { children: account._id },
      });
    }

    // Add to new parent
    if (newParentId && oldParentId !== newParentId) {
      await this.accountModel.findByIdAndUpdate(newParentId, {
        $addToSet: { children: account._id },
      });
    }

    // Update child hierarchy recursively
    await this.updateChildHierarchy(id, newHierarchyPath, newLevel);

    return updatedAccount;
  }

  private async updateChildHierarchy(
    parentId: string,
    parentPath: string,
    parentLevel: number,
  ): Promise<void> {
    const children = await this.accountModel.find({ parentAccount: parentId });

    for (const child of children as any) {
      const newPath = `${parentPath}.${child._id}`;
      const newLevel = parentLevel + 1;

      await this.accountModel.findByIdAndUpdate(child._id, {
        hierarchyPath: newPath,
        level: newLevel,
      });

      await this.updateChildHierarchy(child._id.toString(), newPath, newLevel);
    }
  }

  async remove(id: string): Promise<void> {
    const account = await this.accountModel.findById(id);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    // Check if account has children
    if (account.children && account.children.length > 0) {
      throw new BadRequestException('Cannot delete account with children');
    }

    // Remove from parent's children array
    if (account.parentAccount) {
      await this.accountModel.findByIdAndUpdate(account.parentAccount, {
        $pull: { children: account._id },
      });
    }

    await this.accountModel.findByIdAndDelete(id);
  }

  async getAccountStats(clientId: string): Promise<any> {
    const stats = await this.accountModel.aggregate([
      { $match: { clientId: new Types.ObjectId(clientId) } },
      {
        $group: {
          _id: '$level',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalAccounts = await this.accountModel.countDocuments({
      clientId: new Types.ObjectId(clientId),
    });

    return {
      totalAccounts,
      levelBreakdown: stats,
    };
  }

  async getBranchStats(parentId: string): Promise<any> {
    const parent = await this.accountModel.findById(parentId);
    if (!parent) {
      throw new NotFoundException('Parent account not found');
    }

    // Get all descendants using hierarchyPath
    const descendants = await this.accountModel.find({
      hierarchyPath: new RegExp(`^${parent.hierarchyPath}\\.`),
      clientId: parent.clientId,
    });

    // Group by level
    const levelStats = descendants.reduce((acc, account) => {
      const level = account.level;
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {});

    const levelBreakdown = Object.entries(levelStats)
      .map(([level, count]) => ({
        level: parseInt(level),
        count,
      }))
      .sort((a, b) => a.level - b.level);

    return {
      parentAccount: {
        _id: parent._id,
        accountName: parent.accountName,
        level: parent.level,
      },
      totalDescendants: descendants.length,
      directChildren: parent.children.length,
      levelBreakdown,
    };
  }

  // Optimized version using aggregation for large hierarchies
  async findAccountHierarchyOptimized(accountId: string): Promise<any> {
    const pipeline = [
      {
        $match: { _id: new Types.ObjectId(accountId) },
      },
      {
        $graphLookup: {
          from: 'accounts',
          startWith: '$children',
          connectFromField: 'children',
          connectToField: '_id',
          as: 'descendants',
          maxDepth: 4,
          depthField: 'depth',
        },
      },
      {
        $addFields: {
          descendants: {
            $concatArrays: [
              [
                {
                  _id: '$_id',
                  accountName: '$accountName',
                  level: '$level',
                  hierarchyPath: '$hierarchyPath',
                  parentAccount: '$parentAccount',
                  children: '$children',
                  clientId: '$clientId',
                  depth: 0,
                },
              ],
              '$descendants',
            ],
          },
        },
      },
      {
        $unwind: '$descendants',
      },
      {
        $lookup: {
          from: 'clients',
          localField: 'descendants.clientId',
          foreignField: '_id',
          as: 'descendants.client',
        },
      },
      {
        $unwind: {
          path: '$descendants.client',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: null,
          descendants: { $push: '$descendants' },
        },
      },
      {
        $project: {
          _id: 0,
          descendants: 1,
        },
      },
    ];

    const result = await this.accountModel.aggregate(pipeline);

    if (!result || result.length === 0) {
      throw new NotFoundException('Account not found');
    }

    return this.buildTreeFromDescendants(result[0].descendants);
  }

  private buildTreeFromDescendants(descendants: any[]): any {
    const nodeMap = new Map();

    // First pass: Create all nodes
    descendants.forEach((desc) => {
      nodeMap.set(desc._id.toString(), {
        _id: desc._id,
        accountName: desc.accountName,
        level: desc.level,
        hierarchyPath: desc.hierarchyPath,
        client: desc.client || null,
        children: [],
      });
    });

    // Second pass: Build parent-child relationships
    descendants.forEach((desc) => {
      if (desc.children && Array.isArray(desc.children)) {
        const parent = nodeMap.get(desc._id.toString());
        desc.children.forEach((childId: any) => {
          const child = nodeMap.get(childId.toString());
          if (child && parent) {
            parent.children.push(child);
          }
        });
      }
    });

    // Return the root node (depth 0)
    const rootNode = descendants.find((d) => d.depth === 0);
    return nodeMap.get(rootNode._id.toString());
  }
}
