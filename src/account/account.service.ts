// account.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Account, AccountDocument } from './schema/account.schema';
import { CreateAccountDto } from './dto/create-account.dto';
import axios from 'axios';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(
    @InjectModel(Account.name) private accountModel: Model<AccountDocument>,
  ) {}

  async create(
    createAccountDto: CreateAccountDto,
    userId?: string,
  ): Promise<Account> {
    const startTime = Date.now();

    try {
      const { accountName, parentAccount, clientId } = createAccountDto;

      this.logger.log(
        `Creating account with name: ${accountName} for client: ${clientId}`,
      );

      let level = 1;
      let hierarchyPath = '';
      let parentDoc: any = null;

      // If parentAccount is provided, validate and get parent details
      if (parentAccount) {
        parentDoc = await this.accountModel.findById(parentAccount);
        if (!parentDoc) {
          const errorMessage = 'Parent account not found';

          // 📝 Log parent not found error
          await this.sendLog({
            method: 'POST',
            url: '/api/accounts',
            statusCode: 404,
            operation: 'CREATE',
            resource: 'ACCOUNT',
            message: 'Account creation failed - parent account not found',
            userId,
            metadata: {
              requestData: createAccountDto,
              parentAccountId: parentAccount,
              errorType: 'PARENT_NOT_FOUND',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new NotFoundException(errorMessage);
        }

        // Check if parent is already at level 5
        if (parentDoc.level >= 5) {
          const errorMessage = 'Cannot create account beyond level 5';

          // 📝 Log level limit error
          await this.sendLog({
            method: 'POST',
            url: '/api/accounts',
            statusCode: 400,
            operation: 'CREATE',
            resource: 'ACCOUNT',
            message: 'Account creation failed - level limit exceeded',
            userId,
            metadata: {
              requestData: createAccountDto,
              parentLevel: parentDoc.level,
              errorType: 'LEVEL_LIMIT_EXCEEDED',
            },
            responseTime: Date.now() - startTime,
            isError: true,
            errorMessage,
          });

          throw new BadRequestException(errorMessage);
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

      // 📝 Log successful creation
      await this.sendLog({
        method: 'POST',
        url: '/api/accounts',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'ACCOUNT',
        message: `Account created successfully: ${savedAccount.accountName}`,
        userId,
        metadata: {
          accountId: savedAccount._id,
          accountName: savedAccount.accountName,
          level: savedAccount.level,
          hierarchyPath: savedAccount.hierarchyPath,
          parentAccountId: parentAccount,
          clientId: savedAccount.clientId,
          requestData: createAccountDto,
        },
        responseTime: Date.now() - startTime,
      });

      return savedAccount;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'POST',
          url: '/api/accounts',
          statusCode: 500,
          operation: 'CREATE',
          resource: 'ACCOUNT',
          message: `Account creation failed: ${error.message}`,
          userId,
          metadata: {
            requestData: createAccountDto,
            errorType: error.name,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to create account: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAll(clientId: string, userId?: string): Promise<Account[]> {
    const startTime = Date.now();

    try {
      this.logger.log(`Retrieving all accounts for client: ${clientId}`);

      const accounts = await this.accountModel
        .find({ clientId: new Types.ObjectId(clientId) })
        .populate('parentAccount', 'accountName level')
        .populate('children', 'accountName level')
        .exec();

      this.logger.log(
        `Retrieved ${accounts.length} accounts for client: ${clientId}`,
      );

      // 📝 Log successful retrieval
      await this.sendLog({
        method: 'GET',
        url: '/api/accounts',
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Successfully retrieved ${accounts.length} accounts`,
        userId,
        metadata: {
          clientId,
          retrievedCount: accounts.length,
        },
        responseTime: Date.now() - startTime,
      });

      return accounts;
    } catch (error) {
      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: '/api/accounts',
        statusCode: 500,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Failed to retrieve accounts: ${error.message}`,
        userId,
        metadata: { clientId },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to retrieve accounts: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findOne(id: string, userId?: string): Promise<Account> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding account with ID: ${id}`);

      const account = await this.accountModel
        .findById(id)
        .populate('parentAccount', 'accountName level')
        .populate('children', 'accountName level')
        .exec();

      if (!account) {
        this.logger.warn(`No account found with ID: ${id}`);

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Account not found with ID: ${id}`,
          userId,
          metadata: { accountId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException('Account not found');
      }

      this.logger.log(`Account found with ID: ${id}`);

      // 📝 Log successful find
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/${id}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Account found successfully`,
        userId,
        metadata: {
          accountId: id,
          accountName: account.accountName,
          level: account.level,
          hierarchyPath: account.hierarchyPath,
        },
        responseTime: Date.now() - startTime,
      });

      return account;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${id}`,
          statusCode: 500,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Failed to find account: ${error.message}`,
          userId,
          metadata: { accountId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to find account with ID ${id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findAccountHierarchy(accountId: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding account hierarchy for ID: ${accountId}`);

      const account: any = await this.accountModel.findById(accountId);
      if (!account) {
        const errorMessage = 'Account not found';

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${accountId}/hierarchy`,
          statusCode: 404,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Account hierarchy - account not found: ${accountId}`,
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(errorMessage);
      }

      const hierarchy = await this.buildHierarchyTree(account._id.toString());

      // 📝 Log successful hierarchy retrieval
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/${accountId}/hierarchy`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Account hierarchy retrieved successfully`,
        userId,
        metadata: {
          accountId,
          accountName: account.accountName,
          level: account.level,
        },
        responseTime: Date.now() - startTime,
      });

      return hierarchy;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${accountId}/hierarchy`,
          statusCode: 500,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Failed to retrieve account hierarchy: ${error.message}`,
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to find account hierarchy: ${error.message}`,
        error.stack,
      );
      throw error;
    }
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

  async findByLevel(
    level: number,
    clientId: string,
    userId?: string,
  ): Promise<Account[]> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Finding accounts by level: ${level} for client: ${clientId}`,
      );

      if (level < 1 || level > 5) {
        const errorMessage = 'Level must be between 1 and 5';

        // 📝 Log bad request
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/level/${level}`,
          statusCode: 400,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: 'Invalid level parameter',
          userId,
          metadata: {
            level,
            clientId,
            errorType: 'INVALID_LEVEL',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      const accounts = await this.accountModel
        .find({
          level,
          clientId: new Types.ObjectId(clientId),
        })
        .populate('parentAccount', 'accountName')
        .exec();

      // 📝 Log successful retrieval
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/level/${level}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Successfully retrieved ${accounts.length} accounts at level ${level}`,
        userId,
        metadata: {
          level,
          clientId,
          retrievedCount: accounts.length,
        },
        responseTime: Date.now() - startTime,
      });

      return accounts;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!(error instanceof BadRequestException)) {
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/level/${level}`,
          statusCode: 500,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Failed to retrieve accounts by level: ${error.message}`,
          userId,
          metadata: { level, clientId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to find accounts by level: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async findDescendants(
    accountId: string,
    userId?: string,
  ): Promise<Account[]> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding descendants for account ID: ${accountId}`);

      const account = await this.accountModel.findById(accountId);
      if (!account) {
        const errorMessage = 'Account not found';

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${accountId}/descendants`,
          statusCode: 404,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Account not found for descendants search: ${accountId}`,
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(errorMessage);
      }

      // Find all accounts whose hierarchyPath starts with the current account's path
      const descendants = await this.accountModel
        .find({
          hierarchyPath: new RegExp(`^${account.hierarchyPath}`),
          _id: { $ne: account._id },
        })
        .exec();

      // 📝 Log successful retrieval
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/${accountId}/descendants`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Successfully retrieved ${descendants.length} descendants`,
        userId,
        metadata: {
          accountId,
          accountName: account.accountName,
          descendantsCount: descendants.length,
        },
        responseTime: Date.now() - startTime,
      });

      return descendants;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${accountId}/descendants`,
          statusCode: 500,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Failed to retrieve descendants: ${error.message}`,
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to find descendants: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async update(
    id: string,
    updateAccountDto: any,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Updating account with ID: ${id}`);

      const account = await this.accountModel.findById(id);
      if (!account) {
        const errorMessage = 'Account not found';

        // 📝 Log not found
        await this.sendLog({
          method: 'PUT',
          url: `/api/accounts/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'ACCOUNT',
          message: `Account not found for update: ${id}`,
          userId,
          metadata: {
            accountId: id,
            updateData: updateAccountDto,
          },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(errorMessage);
      }

      const oldParentId = account.parentAccount?.toString();
      const newParentId = updateAccountDto.parentAccount;

      let newHierarchyPath = account.hierarchyPath; // Keep current by default
      let newLevel = account.level; // Keep current by default

      // Only recalculate if parent is changing
      if (oldParentId !== newParentId) {
        if (newParentId) {
          const parentAccount: any =
            await this.accountModel.findById(newParentId);
          if (!parentAccount) {
            const errorMessage = 'Parent account not found';

            // 📝 Log parent not found
            await this.sendLog({
              method: 'PUT',
              url: `/api/accounts/${id}`,
              statusCode: 404,
              operation: 'UPDATE',
              resource: 'ACCOUNT',
              message: 'Account update failed - parent account not found',
              userId,
              metadata: {
                accountId: id,
                newParentId,
                updateData: updateAccountDto,
                errorType: 'PARENT_NOT_FOUND',
              },
              responseTime: Date.now() - startTime,
              isError: true,
              errorMessage,
            });

            throw new NotFoundException(errorMessage);
          }

          // Check if parent is at level 5 (max depth)
          if (parentAccount.level >= 5) {
            throw new BadRequestException('Cannot move account beyond level 5');
          }

          newLevel = parentAccount.level + 1;

          // Calculate the next index among siblings
          const siblings = await this.accountModel.find({
            parentAccount: newParentId,
            _id: { $ne: id }, // Exclude the current account being moved
          });

          // Find the highest index among siblings
          let nextIndex = 1;
          if (siblings.length > 0) {
            const siblingPaths = siblings.map((s) => s.hierarchyPath);
            const indices = siblingPaths.map((path) => {
              const parts = path.split('.');
              return parseInt(parts[parts.length - 1]) || 0;
            });
            nextIndex = Math.max(...indices) + 1;
          }

          // Build new hierarchy path
          if (parentAccount.hierarchyPath) {
            newHierarchyPath = `${parentAccount.hierarchyPath}.${nextIndex}`;
          } else {
            newHierarchyPath = `${nextIndex}`;
          }
        } else {
          // Moving to top level (no parent)
          newLevel = 1;

          // Find next available top-level index
          const topLevelAccounts = await this.accountModel.find({
            level: 1,
            clientId: account.clientId,
            _id: { $ne: id }, // Exclude current account
          });

          let nextIndex = 1;
          if (topLevelAccounts.length > 0) {
            const indices = topLevelAccounts.map(
              (acc) => parseInt(acc.hierarchyPath) || 0,
            );
            nextIndex = Math.max(...indices) + 1;
          }

          newHierarchyPath = `${nextIndex}`;
        }
      }

      // Remove system fields from update DTO
      const { level, hierarchyPath, children, _id, ...safeUpdateDto } =
        updateAccountDto;

      // Update account
      const updatedAccount: any = await this.accountModel
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

      // Update parent relationships only if parent changed
      if (oldParentId !== newParentId) {
        // Remove from old parent's children array
        if (oldParentId) {
          await this.accountModel.findByIdAndUpdate(oldParentId, {
            $pull: { children: account._id },
          });
        }

        // Add to new parent's children array
        if (newParentId) {
          await this.accountModel.findByIdAndUpdate(newParentId, {
            $addToSet: { children: account._id },
          });
        }

        // Update all descendants' hierarchy paths if this account has children
        if (account.children && account.children.length > 0) {
          await this.updateDescendantsHierarchy(
            id,
            account.hierarchyPath,
            newHierarchyPath,
            account.level,
            newLevel,
          );
        }
      }

      // 📝 Log successful update
      await this.sendLog({
        method: 'PUT',
        url: `/api/accounts/${id}`,
        statusCode: 200,
        operation: 'UPDATE',
        resource: 'ACCOUNT',
        message: `Account updated successfully: ${updatedAccount.accountName}`,
        userId,
        metadata: {
          accountId: id,
          accountName: updatedAccount.accountName,
          oldParentId,
          newParentId,
          oldLevel: account.level,
          newLevel,
          oldHierarchyPath: account.hierarchyPath,
          newHierarchyPath,
          updateData: updateAccountDto,
        },
        responseTime: Date.now() - startTime,
      });

      return updatedAccount;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'PUT',
          url: `/api/accounts/${id}`,
          statusCode: 500,
          operation: 'UPDATE',
          resource: 'ACCOUNT',
          message: `Account update failed: ${error.message}`,
          userId,
          metadata: {
            accountId: id,
            updateData: updateAccountDto,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to update account: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Optimized method to update all descendants at once
  private async updateDescendantsHierarchy(
    parentId: string,
    oldParentPath: string,
    newParentPath: string,
    oldParentLevel: number,
    newParentLevel: number,
  ): Promise<void> {
    const levelDiff = newParentLevel - oldParentLevel;

    // Find all descendants using regex pattern
    const descendants = await this.accountModel.find({
      hierarchyPath: new RegExp(`^${oldParentPath}\\.`),
    });

    // Bulk update all descendants
    const bulkOps = descendants.map((descendant: any) => {
      // Replace the old parent path with the new parent path
      const newPath = descendant.hierarchyPath.replace(
        oldParentPath,
        newParentPath,
      );
      const newLevel = descendant.level + levelDiff;

      return {
        updateOne: {
          filter: { _id: descendant._id },
          update: {
            $set: {
              hierarchyPath: newPath,
              level: newLevel,
            },
          },
        },
      };
    });

    if (bulkOps.length > 0) {
      await this.accountModel.bulkWrite(bulkOps);
    }
  }

  // Alternative: Recursive update (keeping for reference, but bulk update is better)
  private async updateChildHierarchyRecursive(
    parentId: string,
    parentPath: string,
    parentLevel: number,
  ): Promise<void> {
    const children = await this.accountModel.find({ parentAccount: parentId });

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as any;
      const childIndex = i + 1;
      const newPath = `${parentPath}.${childIndex}`;
      const newLevel = parentLevel + 1;

      await this.accountModel.findByIdAndUpdate(child._id, {
        hierarchyPath: newPath,
        level: newLevel,
      });

      // Recursively update this child's descendants
      await this.updateChildHierarchyRecursive(
        child._id.toString(),
        newPath,
        newLevel,
      );
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Deleting account with ID: ${id}`);

      const account = await this.accountModel.findById(id);
      if (!account) {
        const errorMessage = 'Account not found';

        // 📝 Log not found
        await this.sendLog({
          method: 'DELETE',
          url: `/api/accounts/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'ACCOUNT',
          message: `Account not found for deletion: ${id}`,
          userId,
          metadata: { accountId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(errorMessage);
      }

      // Check if account has children
      if (account.children && account.children.length > 0) {
        const errorMessage = 'Cannot delete account with children';

        // 📝 Log children exist error
        await this.sendLog({
          method: 'DELETE',
          url: `/api/accounts/${id}`,
          statusCode: 400,
          operation: 'DELETE',
          resource: 'ACCOUNT',
          message: 'Account deletion failed - account has children',
          userId,
          metadata: {
            accountId: id,
            accountName: account.accountName,
            childrenCount: account.children.length,
            errorType: 'HAS_CHILDREN',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      // Remove from parent's children array
      if (account.parentAccount) {
        await this.accountModel.findByIdAndUpdate(account.parentAccount, {
          $pull: { children: account._id },
        });
      }

      await this.accountModel.findByIdAndDelete(id);

      // 📝 Log successful deletion
      await this.sendLog({
        method: 'DELETE',
        url: `/api/accounts/${id}`,
        statusCode: 200,
        operation: 'DELETE',
        resource: 'ACCOUNT',
        message: `Account deleted successfully: ${account.accountName}`,
        userId,
        metadata: {
          accountId: id,
          deletedAccountName: account.accountName,
          level: account.level,
          hierarchyPath: account.hierarchyPath,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'DELETE',
          url: `/api/accounts/${id}`,
          statusCode: 500,
          operation: 'DELETE',
          resource: 'ACCOUNT',
          message: `Account deletion failed: ${error.message}`,
          userId,
          metadata: { accountId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to delete account: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getAccountStats(clientId: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Getting account stats for client: ${clientId}`);

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

      const result = {
        totalAccounts,
        levelBreakdown: stats,
      };

      // 📝 Log successful stats retrieval
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/stats/${clientId}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Account stats retrieved successfully`,
        userId,
        metadata: {
          clientId,
          totalAccounts,
          levelBreakdownCount: stats.length,
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      // 📝 Log error
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/stats/${clientId}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Failed to retrieve account stats: ${error.message}`,
        userId,
        metadata: { clientId },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to get account stats: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getBranchStats(parentId: string, userId?: string): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(`Getting branch stats for parent ID: ${parentId}`);

      const parent = await this.accountModel.findById(parentId);
      if (!parent) {
        const errorMessage = 'Parent account not found';

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/branch-stats/${parentId}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Parent account not found for branch stats: ${parentId}`,
          userId,
          metadata: { parentId },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(errorMessage);
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

      const result = {
        parentAccount: {
          _id: parent._id,
          accountName: parent.accountName,
          level: parent.level,
        },
        totalDescendants: descendants.length,
        directChildren: parent.children.length,
        levelBreakdown,
      };

      // 📝 Log successful branch stats retrieval
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/branch-stats/${parentId}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Branch stats retrieved successfully`,
        userId,
        metadata: {
          parentId,
          parentAccountName: parent.accountName,
          totalDescendants: descendants.length,
          directChildren: parent.children.length,
        },
        responseTime: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/branch-stats/${parentId}`,
          statusCode: 500,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Failed to retrieve branch stats: ${error.message}`,
          userId,
          metadata: { parentId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to get branch stats: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Optimized version using aggregation for large hierarchies
  async findAccountHierarchyOptimized(
    accountId: string,
    userId?: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Finding optimized account hierarchy for ID: ${accountId}`,
      );

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
        const errorMessage = 'Account not found';

        // 📝 Log not found
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${accountId}/hierarchy-optimized`,
          statusCode: 404,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Account not found for optimized hierarchy: ${accountId}`,
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(errorMessage);
      }

      const hierarchy = this.buildTreeFromDescendants(result[0].descendants);

      // 📝 Log successful optimized hierarchy retrieval
      await this.sendLog({
        method: 'GET',
        url: `/api/accounts/${accountId}/hierarchy-optimized`,
        statusCode: 200,
        operation: 'READ',
        resource: 'ACCOUNT',
        message: `Optimized account hierarchy retrieved successfully`,
        userId,
        metadata: {
          accountId,
          descendantsCount: result[0].descendants.length,
        },
        responseTime: Date.now() - startTime,
      });

      return hierarchy;
    } catch (error) {
      // 📝 Log error (only if not already logged)
      if (!(error instanceof NotFoundException)) {
        await this.sendLog({
          method: 'GET',
          url: `/api/accounts/${accountId}/hierarchy-optimized`,
          statusCode: 500,
          operation: 'READ',
          resource: 'ACCOUNT',
          message: `Failed to retrieve optimized hierarchy: ${error.message}`,
          userId,
          metadata: { accountId },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });
      }

      this.logger.error(
        `Failed to find optimized account hierarchy: ${error.message}`,
        error.stack,
      );
      throw error;
    }
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

  private async sendLog(logData: {
    method: string;
    url: string;
    statusCode: number;
    operation: string;
    resource: string;
    message: string;
    userId?: string;
    metadata?: any;
    responseTime?: number;
    isError?: boolean;
    errorMessage?: string;
    stackTrace?: string;
  }): Promise<void> {
    try {
      await axios.post(
        this.logsServiceUrl,
        {
          ...logData,
          timestamp: new Date(),
          ipAddress: 'internal',
          userAgent: 'account-service',
        },
        {
          timeout: 5000, // 5 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Silent fail - don't let logging break main functionality
      this.logger.warn(`Failed to send log to microservice: ${error.message}`);
    }
  }
}
