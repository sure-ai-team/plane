/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import type {
  IFormattedInstanceConfiguration,
  IInstance,
  IInstanceAdmin,
  IInstanceConfiguration,
  IInstanceInfo,
  TBulkUserCreatePayload,
  TBulkUserCreateResponse,
  TBulkUserRole,
  TBulkUserRowResult,
  TInstanceUserCreatePayload,
  TInstanceUserDetail,
  TInstanceUserListParams,
  TInstanceUserListResponse,
  TInstanceUserPasswordResult,
  TInstanceUserUpdatePayload,
  TPage,
} from "@plane/types";
// api service
import { APIService } from "../api.service";

/**
 * Service class for managing instance-related operations
 * Handles retrieval of instance information and changelog
 * @extends {APIService}
 */
export class InstanceService extends APIService {
  /**
   * Creates an instance of InstanceService
   * Initializes the service with the base API URL
   */
  constructor() {
    super(API_BASE_URL);
  }

  /**
   * Retrieves information about the current instance
   * @returns {Promise<IInstanceInfo>} Promise resolving to instance information
   * @throws {Error} If the API request fails
   * @remarks This method uses the validateStatus: null option to bypass interceptors for unauthorized errors.
   */
  async info(): Promise<IInstanceInfo> {
    return this.get("/api/instances/", { validateStatus: null })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches the changelog for the current instance
   * @returns {Promise<TPage>} Promise resolving to the changelog page data
   * @throws {Error} If the API request fails
   */
  async changelog(): Promise<TPage> {
    return this.get("/api/instances/changelog/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches the list of instance admins
   * @returns {Promise<IInstanceAdmin[]>} Promise resolving to an array of instance admins
   * @throws {Error} If the API request fails
   * @remarks This method uses the validateStatus: null option to bypass interceptors for unauthorized errors.
   */
  async admins(): Promise<IInstanceAdmin[]> {
    return this.get("/api/instances/admins/", { validateStatus: null })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Updates the instance information
   * @param {Partial<IInstance>} data Data to update the instance with
   * @returns {Promise<IInstance>} Promise resolving to the updated instance information
   * @throws {Error} If the API request fails
   */
  async update(data: Partial<IInstance>): Promise<IInstance> {
    return this.patch("/api/instances/", data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Fetches the list of instance configurations
   * @returns {Promise<IInstanceConfiguration[]>} Promise resolving to an array of instance configurations
   * @throws {Error} If the API request fails
   */
  async configurations(): Promise<IInstanceConfiguration[]> {
    return this.get("/api/instances/configurations/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Updates the instance configurations
   * @param {Partial<IFormattedInstanceConfiguration>} data Data to update the instance configurations with
   * @returns {Promise<IInstanceConfiguration[]>} The updated instance configurations
   * @throws {Error} If the API request fails
   */
  async updateConfigurations(data: Partial<IFormattedInstanceConfiguration>): Promise<IInstanceConfiguration[]> {
    return this.patch("/api/instances/configurations/", data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Sends a test email to the specified receiver to test SMTP configuration
   * @param {string} receiverEmail Email address to send the test email to
   * @returns {Promise<void>} Promise resolving to void
   * @throws {Error} If the API request fails
   */
  async sendTestEmail(receiverEmail: string): Promise<void> {
    return this.post("/api/instances/email-credentials-check/", {
      receiver_email: receiverEmail,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Creates one user account with a generated temporary password
   * @param {TInstanceUserCreatePayload} data User details; an existing account is only added to the workspace
   * @returns {Promise<TBulkUserRowResult>} The result, including the temporary password for a new account
   * @throws {TBulkUserCreateError} If the details are invalid
   */
  async createUser(data: TInstanceUserCreatePayload): Promise<TBulkUserRowResult> {
    return this.post("/api/instances/users/", data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Lists user accounts on the instance, newest first
   * @param {TInstanceUserListParams} params Search text, status and workspace filters, and the page cursor
   * @returns {Promise<TInstanceUserListResponse>} One page of accounts
   */
  async listUsers(params: TInstanceUserListParams = {}): Promise<TInstanceUserListResponse> {
    return this.get("/api/instances/users/", { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Gets one account with its workspaces and the projects in each
   * @param {string} userId Account id
   */
  async getUser(userId: string): Promise<TInstanceUserDetail> {
    return this.get(`/api/instances/users/${userId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Edits an account's name, email or phone
   * @throws {TBulkUserCreateError} If a value is invalid
   */
  async updateUser(userId: string, data: TInstanceUserUpdatePayload): Promise<TInstanceUserDetail> {
    return this.patch(`/api/instances/users/${userId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Permanently deletes an account and the data tied to it
   * @param {string} confirmEmail The account's email, typed by the admin to confirm
   */
  async deleteUser(userId: string, confirmEmail: string): Promise<void> {
    return this.delete(`/api/instances/users/${userId}/`, { confirm_email: confirmEmail })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Sets a new password for an account and signs it out everywhere
   * @param {string} password Optional; a strong password is generated when empty
   * @returns {Promise<TInstanceUserPasswordResult>} The new password, shown once
   */
  async setUserPassword(userId: string, password = ""): Promise<TInstanceUserPasswordResult> {
    return this.post(`/api/instances/users/${userId}/password/`, { password })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Deactivates (blocks sign-in and suspends all memberships) or reactivates an account
   */
  async setUserActive(userId: string, isActive: boolean): Promise<TInstanceUserDetail> {
    return this.post(`/api/instances/users/${userId}/activation/`, { is_active: isActive })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Adds an account to a workspace, or restores a suspended membership
   */
  async addUserToWorkspace(userId: string, workspace: string, role: TBulkUserRole): Promise<TInstanceUserDetail> {
    return this.post(`/api/instances/users/${userId}/workspaces/`, { workspace, role })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Changes an account's role in a workspace
   */
  async updateUserWorkspaceRole(userId: string, slug: string, role: TBulkUserRole): Promise<TInstanceUserDetail> {
    return this.patch(`/api/instances/users/${userId}/workspaces/${slug}/`, { role })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Removes an account from a workspace and its projects (shown as Suspended in the workspace)
   */
  async removeUserFromWorkspace(userId: string, slug: string): Promise<TInstanceUserDetail> {
    return this.delete(`/api/instances/users/${userId}/workspaces/${slug}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Adds an account to a project, or changes its role there
   */
  async setUserProjectRole(userId: string, projectId: string, role: TBulkUserRole): Promise<TInstanceUserDetail> {
    return this.put(`/api/instances/users/${userId}/projects/${projectId}/`, { role })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Removes an account from a project
   */
  async removeUserFromProject(userId: string, projectId: string): Promise<TInstanceUserDetail> {
    return this.delete(`/api/instances/users/${userId}/projects/${projectId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Downloads the Excel template for bulk user creation
   * @returns {Promise<Blob>} Promise resolving to the .xlsx file
   * @throws {Error} If the API request fails
   */
  async downloadBulkUserTemplate(): Promise<Blob> {
    return this.get("/api/instances/users/bulk-create/template/", { responseType: "blob" })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Creates user accounts from an uploaded .xlsx or .csv file
   * @param {TBulkUserCreatePayload} payload File plus defaults; dryRun checks the file without saving
   * @returns {Promise<TBulkUserCreateResponse>} Per-row results, including temporary passwords for new accounts
   * @throws {TBulkUserCreateError} If the file or options are invalid
   */
  async bulkCreateUsers(payload: TBulkUserCreatePayload): Promise<TBulkUserCreateResponse> {
    const formData = new FormData();
    formData.append("file", payload.file);
    formData.append("dry_run", payload.dryRun ? "true" : "false");
    if (payload.workspace) formData.append("workspace", payload.workspace);
    if (payload.role) formData.append("role", payload.role);
    return this.post("/api/instances/users/bulk-create/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Disables the email configuration
   * @returns {Promise<void>} Promise resolving to void
   * @throws {Error} If the API request fails
   */
  async disableEmail(): Promise<void> {
    return this.delete("/api/instances/configurations/disable-email-feature/")
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
